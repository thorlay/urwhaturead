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
)

type FeedBriefingScheduler struct {
	db                *gorm.DB
	summarizer        *aisummary.Client
	helper            *FeedHandler
	tick              time.Duration
	limit             int
	maxSourcesPerTick int
	minNewArticles    int
}

type FeedBriefingSchedulerOptions struct {
	TickSec           int
	Limit             int
	MaxSourcesPerTick int
	MinNewArticles    int
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
	return &FeedBriefingScheduler{
		db:                db,
		summarizer:        summarizer,
		helper:            NewFeedHandler(db, summarizer, FeedHandlerOptions{}),
		tick:              tick,
		limit:             limit,
		maxSourcesPerTick: maxSources,
		minNewArticles:    minNewArticles,
	}
}

func (s *FeedBriefingScheduler) Start(ctx context.Context) {
	if s == nil || s.summarizer == nil {
		return
	}
	ticker := time.NewTicker(s.tick)
	defer ticker.Stop()
	log.Printf("auto ai briefing scheduler started; tick=%s", s.tick)
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

	now := time.Now().UTC()
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
	promptRows := rows
	previous, err := s.loadLatestSourceBriefing(ctx, source.ID)
	if err != nil {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}
	if previous != nil {
		selectedRows, newCount, shouldGenerate := selectSourceBriefingRows(rows, parseCSVUint64Loose(previous.ArticleIDs), s.minNewArticles)
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
		prompt = "这是一轮增量 AI 速览。只总结相对上次真正新增、出现变化、或值得重新关注的信息。不要重复复述上次已经明确的背景；如果新增较少，宁可更短，也不要硬凑结构。\n\n" + prompt
	}
	result, err := s.summarizer.CompleteWithModel(
		ctx,
		"你是一个中文新闻编辑台 AI。请先在心里合并重复事件，再按重要性输出。优先保留真正新增、多源确认、讨论升温、影响较大的信息；不要把所有条目写成同等重要，也不要重复复述同一事件的背景。",
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

func selectSourceBriefingRows(rows []feedItem, previousArticleIDs []uint64, minNewArticles int) ([]feedItem, int, bool) {
	if len(rows) == 0 {
		return nil, 0, false
	}
	if len(previousArticleIDs) == 0 {
		return rows, len(rows), true
	}
	if minNewArticles <= 0 {
		minNewArticles = 1
	}

	seen := make(map[uint64]struct{}, len(previousArticleIDs))
	for _, articleID := range previousArticleIDs {
		seen[articleID] = struct{}{}
	}

	newRows := make([]feedItem, 0, len(rows))
	for _, row := range rows {
		if _, ok := seen[row.ID]; ok {
			continue
		}
		newRows = append(newRows, row)
	}

	if len(newRows) < minNewArticles {
		return nil, len(newRows), false
	}
	return newRows, len(newRows), true
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
