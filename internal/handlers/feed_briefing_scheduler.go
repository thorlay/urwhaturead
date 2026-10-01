package handlers

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"quick/internal/aisummary"
	"quick/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FeedBriefingScheduler struct {
	db                *gorm.DB
	summarizer        *aisummary.Client
	helper            *FeedHandler
	tick              time.Duration
	limit             int
	maxSourcesPerTick int
	minNewArticles    int
	dedupWindow       time.Duration
	minReplyDelta     int
	scheduleLocation  *time.Location
	blockedWindows    []weeklyScheduleWindow
	scheduleLabel     string
	dailyMinute       int
}

type FeedBriefingSchedulerOptions struct {
	TickSec           int
	Limit             int
	MaxSourcesPerTick int
	MinNewArticles    int
	DedupWindowHours  int
	MinReplyDelta     int
	DailyTime         string
	Timezone          string
	BlockedWindows    string
}

type briefingCoverageItem struct {
	ContentHash string
	ReplyCount  *int
}

type sourceBriefingCoverage struct {
	articles map[uint64]briefingCoverageItem
	clusters map[uint64]struct{}
}

func NewFeedBriefingScheduler(db *gorm.DB, summarizer *aisummary.Client, options FeedBriefingSchedulerOptions) *FeedBriefingScheduler {
	tick := time.Duration(options.TickSec) * time.Second
	if tick <= 0 {
		tick = 2 * time.Minute
	}
	limit := options.Limit
	if limit <= 0 || limit > maxBriefingLimit {
		limit = defaultBriefingLimit
	}
	maxSources := options.MaxSourcesPerTick
	if maxSources <= 0 {
		maxSources = 4
	}
	minNewArticles := options.MinNewArticles
	if minNewArticles <= 0 {
		minNewArticles = 3
	}
	dedupWindowHours := options.DedupWindowHours
	if dedupWindowHours <= 0 {
		dedupWindowHours = 14 * 24
	}
	minReplyDelta := options.MinReplyDelta
	if minReplyDelta <= 0 {
		minReplyDelta = 5
	}
	scheduleLocation, blockedWindows := parseBriefingSchedule(options.Timezone, options.BlockedWindows)
	dailyTime := strings.TrimSpace(options.DailyTime)
	if dailyTime == "" {
		dailyTime = "22:00"
	}
	dailyMinute, err := parseScheduleMinute(dailyTime, false)
	if err != nil {
		log.Printf("auto ai briefing disabled: invalid daily time %q", dailyTime)
		blockedWindows = []weeklyScheduleWindow{allWeekScheduleWindow()}
	}
	return &FeedBriefingScheduler{
		dailyMinute:       dailyMinute,
		db:                db,
		summarizer:        summarizer,
		helper:            &FeedHandler{db: db, summarizer: summarizer},
		tick:              tick,
		limit:             limit,
		maxSourcesPerTick: maxSources,
		minNewArticles:    minNewArticles,
		dedupWindow:       time.Duration(dedupWindowHours) * time.Hour,
		minReplyDelta:     minReplyDelta,
		scheduleLocation:  scheduleLocation,
		blockedWindows:    blockedWindows,
		scheduleLabel:     strings.TrimSpace(options.BlockedWindows),
	}
}

func (s *FeedBriefingScheduler) Start(ctx context.Context) {
	if s == nil || s.summarizer == nil {
		return
	}
	ticker := time.NewTicker(s.tick)
	defer ticker.Stop()
	if len(s.blockedWindows) > 0 {
		log.Printf(
			"auto ai briefing scheduler started; tick=%s timezone=%s blocked_windows=%q",
			s.tick,
			s.scheduleLocation.String(),
			s.scheduleLabel,
		)
	} else {
		log.Printf("auto ai briefing scheduler started; tick=%s", s.tick)
	}
	s.runDueSources(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runDueSources(ctx)
		}
	}
}

func (s *FeedBriefingScheduler) runDueSources(ctx context.Context) {
	now := time.Now().UTC()
	if briefingScheduleBlocked(now, s.scheduleLocation, s.blockedWindows) {
		return
	}

	local := now.In(s.scheduleLocation)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.scheduleLocation)
	var sources []models.Source
	if err := s.db.WithContext(ctx).
		Where("enabled = ? AND ai_briefing_enabled = ?", true, true).
		Where("ai_briefing_last_generated_at IS NULL OR ai_briefing_last_generated_at < ?", dayStart).
		Where("ai_briefing_last_run_at IS NULL OR ai_briefing_last_run_at <= ?", now.Add(-10*time.Minute)).
		Order("ai_briefing_last_run_at ASC NULLS FIRST").
		Order("id ASC").
		Limit(s.maxSourcesPerTick * 8).
		Find(&sources).Error; err != nil {
		log.Printf("auto ai briefing query sources failed: %v", err)
		return
	}

	processed := 0
	for _, source := range sources {
		if !dailyBriefingDue(source, now, s.scheduleLocation, s.dailyMinute) {
			continue
		}
		if err := s.runSourceBriefing(ctx, source, now); err != nil {
			log.Printf("auto ai briefing source=%d name=%q failed: %v", source.ID, source.Name, err)
		}
		processed++
		if processed >= s.maxSourcesPerTick {
			return
		}
	}
}

func (s *FeedBriefingScheduler) runSourceBriefing(ctx context.Context, source models.Source, now time.Time) error {
	ctx, cancel := context.WithTimeout(ctx, feedBriefingTaskTimeout)
	defer cancel()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked bool
		if err := tx.Raw("SELECT pg_try_advisory_xact_lock(?)", dailyBriefingLockID(source.ID)).Scan(&locked).Error; err != nil {
			return err
		}
		if !locked {
			return nil
		}
		var current models.Source
		if err := tx.First(&current, source.ID).Error; err != nil {
			return err
		}
		if !current.Enabled || !current.AIBriefingEnabled || !dailyBriefingDue(current, now, s.scheduleLocation, s.dailyMinute) {
			return nil
		}
		copy := *s
		copy.db = tx
		copy.helper = &FeedHandler{db: tx, summarizer: s.summarizer}
		return copy.generateDailyBriefing(ctx, current, now)
	})
	if err != nil {
		retryCtx, retryCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer retryCancel()
		_ = s.touchSourceBriefingRun(retryCtx, source.ID, now, nil)
	}
	return err
}

func (s *FeedBriefingScheduler) generateDailyBriefing(ctx context.Context, source models.Source, now time.Time) error {
	digestKey := dailyBriefingDigest(source.ID, now, s.scheduleLocation)
	var existing models.FeedBriefing
	found := s.db.Where("digest_key = ?", digestKey).Limit(1).Find(&existing)
	if found.Error != nil {
		return found.Error
	}
	if found.RowsAffected > 0 {
		return s.touchSourceBriefingRun(ctx, source.ID, now, &existing.GeneratedAt)
	}
	var ids []uint64
	// Select before LIMIT so previously covered articles cannot hide an unread backlog.
	if err := s.db.Table("articles AS a").Select("a.id").Where("a.source_id = ?", source.ID).
		Where(`NOT EXISTS (SELECT 1 FROM feed_briefing_articles c WHERE c.article_id = a.id)`).
		Where(`NOT EXISTS (SELECT 1 FROM feed_briefings b WHERE a.id::text = ANY(string_to_array(b.article_ids, ',')))`).
		Order("a.created_at ASC, a.id ASC").Limit(s.limit).Scan(&ids).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return s.touchSourceBriefingRun(ctx, source.ID, now, nil)
	}

	rows, err := s.helper.queryBriefingFeedRows(ctx, s.limit, "", "", []uint64{source.ID}, ids)
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	if len(rows) == 0 {
		return s.touchSourceBriefingRun(ctx, source.ID, now, nil)
	}

	model := resolveFeedBriefingModel("", s.summarizer, true)
	promptRows := rows
	_, articleIDs := buildFeedBriefingDigest(s.limit, "", "", model, []uint64{source.ID}, promptRows)
	prompt := buildFeedBriefingPrompt(promptRows)
	result, err := s.summarizer.CompleteWithModel(
		ctx,
		feedBriefingSystemPrompt,
		prompt,
		model,
	)
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}

	record := models.FeedBriefing{
		DigestKey:   digestKey,
		Tag:         "",
		Keyword:     "",
		SourceIDs:   joinUint64([]uint64{source.ID}),
		ArticleIDs:  joinUint64(articleIDs),
		Limit:       s.limit,
		Summary:     result.Summary,
		Model:       result.Model,
		Provider:    result.ProviderName,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		StopReason:  result.StopReason,
		GeneratedAt: result.GeneratedAt,
	}
	if err := s.db.WithContext(ctx).
		Where("digest_key = ?", digestKey).
		Assign(record).
		FirstOrCreate(&record).Error; err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	if err := s.saveBriefingCoverage(ctx, record, source.ID, promptRows); err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}

	if err := s.touchSourceBriefingRun(ctx, source.ID, now, &result.GeneratedAt); err != nil {
		return err
	}
	log.Printf(
		"auto ai briefing source=%d name=%q generated model=%s articles=%d",
		source.ID,
		source.Name,
		strings.TrimSpace(result.Model),
		len(promptRows),
	)
	return nil
}

func (s *FeedBriefingScheduler) loadRecentSourceCoverage(ctx context.Context, sourceID uint64, cutoff time.Time) (sourceBriefingCoverage, error) {
	coverage := sourceBriefingCoverage{
		articles: make(map[uint64]briefingCoverageItem),
		clusters: make(map[uint64]struct{}),
	}

	var briefings []models.FeedBriefing
	if err := s.db.WithContext(ctx).
		Where("tag = ? AND keyword = ? AND source_ids = ? AND generated_at >= ?", "", "", joinUint64([]uint64{sourceID}), cutoff).
		Find(&briefings).Error; err != nil {
		return coverage, err
	}
	if err := s.backfillBriefingCoverage(ctx, sourceID, briefings); err != nil {
		return coverage, err
	}

	var rows []models.FeedBriefingArticle
	if err := s.db.WithContext(ctx).
		Where("source_id = ? AND briefing_created >= ?", sourceID, cutoff).
		Order("briefing_created ASC").
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return coverage, err
	}
	for _, row := range rows {
		coverage.articles[row.ArticleID] = briefingCoverageItem{
			ContentHash: strings.TrimSpace(row.ContentHash),
			ReplyCount:  row.ReplyCount,
		}
		if row.ClusterID != nil && *row.ClusterID != 0 {
			coverage.clusters[*row.ClusterID] = struct{}{}
		}
	}
	return coverage, nil
}

func (s *FeedBriefingScheduler) backfillBriefingCoverage(ctx context.Context, sourceID uint64, briefings []models.FeedBriefing) error {
	if len(briefings) == 0 {
		return nil
	}

	articleIDs := make([]uint64, 0)
	for _, briefing := range briefings {
		articleIDs = append(articleIDs, parseCSVUint64Loose(briefing.ArticleIDs)...)
	}
	articleIDs = uniqueSortedUint64(articleIDs)
	if len(articleIDs) == 0 {
		return nil
	}

	type articleSnapshot struct {
		ID          uint64
		ClusterID   *uint64
		ContentHash string
		ReplyCount  *int
	}
	var snapshots []articleSnapshot
	if err := s.db.WithContext(ctx).
		Table("articles").
		Select("id, cluster_id, content_hash, reply_count").
		Where("source_id = ? AND id IN ?", sourceID, articleIDs).
		Scan(&snapshots).Error; err != nil {
		return err
	}
	byID := make(map[uint64]articleSnapshot, len(snapshots))
	for _, snapshot := range snapshots {
		byID[snapshot.ID] = snapshot
	}

	records := make([]models.FeedBriefingArticle, 0, len(articleIDs))
	for _, briefing := range briefings {
		for _, articleID := range parseCSVUint64Loose(briefing.ArticleIDs) {
			snapshot, ok := byID[articleID]
			if !ok {
				continue
			}
			records = append(records, models.FeedBriefingArticle{
				FeedBriefingID:  briefing.ID,
				SourceID:        sourceID,
				ArticleID:       articleID,
				ClusterID:       snapshot.ClusterID,
				ContentHash:     strings.TrimSpace(snapshot.ContentHash),
				ReplyCount:      snapshot.ReplyCount,
				BriefingCreated: briefing.GeneratedAt.UTC(),
			})
		}
	}
	if len(records) == 0 {
		return nil
	}
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&records).Error
}

func (s *FeedBriefingScheduler) saveBriefingCoverage(ctx context.Context, briefing models.FeedBriefing, sourceID uint64, rows []feedItem) error {
	records := make([]models.FeedBriefingArticle, 0, len(rows))
	seen := make(map[uint64]struct{}, len(rows))
	for _, row := range rows {
		if row.ID == 0 {
			continue
		}
		if _, exists := seen[row.ID]; exists {
			continue
		}
		seen[row.ID] = struct{}{}
		records = append(records, models.FeedBriefingArticle{
			FeedBriefingID:  briefing.ID,
			SourceID:        sourceID,
			ArticleID:       row.ID,
			ClusterID:       row.ClusterID,
			ContentHash:     strings.TrimSpace(row.ContentHash),
			ReplyCount:      row.ReplyCount,
			BriefingCreated: briefing.GeneratedAt.UTC(),
		})
	}
	if len(records) == 0 {
		return nil
	}
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&records).Error
}

func (s *FeedBriefingScheduler) loadLatestSourceBriefing(ctx context.Context, sourceID uint64) (*models.FeedBriefing, error) {
	var briefing models.FeedBriefing
	err := s.db.WithContext(ctx).
		Where("tag = ? AND keyword = ? AND source_ids = ?", "", "", joinUint64([]uint64{sourceID})).
		Order("generated_at DESC").
		Order("id DESC").
		Take(&briefing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &briefing, nil
}

func selectSourceBriefingRows(rows []feedItem, previousArticleIDs []uint64, previousClusterIDs []uint64, minNewArticles int) ([]feedItem, int, bool) {
	coverage := sourceBriefingCoverage{
		articles: make(map[uint64]briefingCoverageItem, len(previousArticleIDs)),
		clusters: make(map[uint64]struct{}, len(previousClusterIDs)),
	}
	for _, articleID := range previousArticleIDs {
		coverage.articles[articleID] = briefingCoverageItem{}
	}
	for _, clusterID := range previousClusterIDs {
		if clusterID != 0 {
			coverage.clusters[clusterID] = struct{}{}
		}
	}
	return selectSourceBriefingRowsWithCoverage(rows, coverage, minNewArticles, 1)
}

func selectSourceBriefingRowsWithCoverage(
	rows []feedItem,
	coverage sourceBriefingCoverage,
	minNewArticles int,
	minReplyDelta int,
) ([]feedItem, int, bool) {
	if len(rows) == 0 {
		return nil, 0, false
	}
	if len(coverage.articles) == 0 && len(coverage.clusters) == 0 {
		return rows, len(rows), true
	}
	if minNewArticles <= 0 {
		minNewArticles = 1
	}
	if minReplyDelta <= 0 {
		minReplyDelta = 1
	}

	newRows := make([]feedItem, 0, len(rows))
	for _, row := range rows {
		if previous, seen := coverage.articles[row.ID]; seen {
			if briefingRowChanged(row, previous, minReplyDelta) {
				newRows = append(newRows, row)
			}
			continue
		}
		if row.ClusterID != nil && *row.ClusterID != 0 {
			if _, ok := coverage.clusters[*row.ClusterID]; ok {
				continue
			}
		}
		newRows = append(newRows, row)
	}

	if len(newRows) < minNewArticles {
		return nil, len(newRows), false
	}
	return newRows, len(newRows), true
}

func briefingRowChanged(row feedItem, previous briefingCoverageItem, minReplyDelta int) bool {
	currentHash := strings.TrimSpace(row.ContentHash)
	if currentHash != "" && previous.ContentHash != "" && currentHash != previous.ContentHash {
		return true
	}
	if row.ReplyCount == nil || previous.ReplyCount == nil {
		return false
	}
	return *row.ReplyCount-*previous.ReplyCount >= minReplyDelta
}

func (s *FeedBriefingScheduler) touchSourceBriefingRun(ctx context.Context, sourceID uint64, runAt time.Time, generatedAt *time.Time) error {
	updates := map[string]any{
		"ai_briefing_last_run_at": runAt,
	}
	if generatedAt != nil && !generatedAt.IsZero() {
		updates["ai_briefing_last_generated_at"] = generatedAt.UTC()
	}
	return s.db.WithContext(ctx).Model(&models.Source{}).Where("id = ?", sourceID).Updates(updates).Error
}
