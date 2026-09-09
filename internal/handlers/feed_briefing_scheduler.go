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
}

type FeedBriefingSchedulerOptions struct {
	TickSec           int
	Limit             int
	MaxSourcesPerTick int
	MinNewArticles    int
	DedupWindowHours  int
	MinReplyDelta     int
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
	return &FeedBriefingScheduler{
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

	var sources []models.Source
	if err := s.db.WithContext(ctx).
		Where("enabled = ? AND ai_briefing_enabled = ?", true, true).
		Order("ai_briefing_last_run_at ASC NULLS FIRST").
		Order("id ASC").
		Limit(s.maxSourcesPerTick * 8).
		Find(&sources).Error; err != nil {
		log.Printf("auto ai briefing query sources failed: %v", err)
		return
	}

	processed := 0
	for _, source := range sources {
		if !sourceAIBriefingDue(source, now) {
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

func sourceAIBriefingDue(source models.Source, now time.Time) bool {
	intervalMin := source.AIBriefingIntervalMin
	if intervalMin <= 0 {
		intervalMin = 360
	}
	if source.AIBriefingLastRunAt == nil || source.AIBriefingLastRunAt.IsZero() {
		return true
	}
	return now.Sub(source.AIBriefingLastRunAt.UTC()) >= time.Duration(intervalMin)*time.Minute
}

func (s *FeedBriefingScheduler) runSourceBriefing(ctx context.Context, source models.Source, now time.Time) error {
	rows, err := s.helper.queryBriefingFeedRows(ctx, s.limit, "", "", []uint64{source.ID}, nil)
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	if len(rows) == 0 {
		return s.touchSourceBriefingRun(ctx, source.ID, now, nil)
	}

	model := resolveFeedBriefingModel("", s.summarizer, true)
	coverage, err := s.loadRecentSourceCoverage(ctx, source.ID, now.Add(-s.dedupWindow))
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	promptRows := rows
	previous, err := s.loadLatestSourceBriefing(ctx, source.ID)
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	if previous != nil {
		selectedRows, newCount, shouldGenerate := selectSourceBriefingRowsWithCoverage(rows, coverage, s.minNewArticles, s.minReplyDelta)
		if !shouldGenerate {
			log.Printf(
				"auto ai briefing source=%d name=%q skipped: only %d new articles (threshold=%d)",
				source.ID,
				source.Name,
				newCount,
				s.minNewArticles,
			)
			return s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		}
		promptRows = selectedRows
	}
	if len(promptRows) == 0 {
		return s.touchSourceBriefingRun(ctx, source.ID, now, nil)
	}

	digestKey, articleIDs := buildFeedBriefingDigest(s.limit, "", "", model, []uint64{source.ID}, promptRows)

	var cached models.FeedBriefing
	if err := s.db.WithContext(ctx).Where("digest_key = ?", digestKey).Take(&cached).Error; err == nil {
		return s.touchSourceBriefingRun(ctx, source.ID, now, &cached.GeneratedAt)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}

	prompt := buildFeedBriefingPrompt(promptRows)
	if previous != nil {
		prompt = "这是一轮增量 AI 速览。只总结相对上次真正新增、出现变化、或值得重新关注的信息。不要重复复述上次已经明确的背景；新增较少时允许更短，但每个真正新增的变化仍要说明关键事实、原因或影响，不要只给一句结论，也不要硬凑结构。\n\n" + prompt
	}
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
