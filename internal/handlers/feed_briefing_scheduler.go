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
}

type FeedBriefingSchedulerOptions struct {
	TickSec           int
	Limit             int
	MaxSourcesPerTick int
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
	return &FeedBriefingScheduler{
		db:                db,
		summarizer:        summarizer,
		helper:            NewFeedHandler(db, summarizer, FeedHandlerOptions{}),
		tick:              tick,
		limit:             limit,
		maxSourcesPerTick: maxSources,
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
	digestKey, articleIDs := buildFeedBriefingDigest(s.limit, "", "", model, []uint64{source.ID}, rows)

	var cached models.FeedBriefing
	if err := s.db.WithContext(ctx).Where("digest_key = ?", digestKey).Take(&cached).Error; err == nil {
		return s.touchSourceBriefingRun(ctx, source.ID, now, &cached.GeneratedAt)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		_ = s.touchSourceBriefingRun(ctx, source.ID, now, nil)
		return err
	}

	prompt := buildFeedBriefingPrompt(rows)
	result, err := s.summarizer.CompleteWithModel(
		ctx,
		"你是一个新闻编辑台 AI，输出中文，每段都要有信息密度和可执行性。",
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
	log.Printf("auto ai briefing source=%d name=%q generated model=%s articles=%d", source.ID, source.Name, strings.TrimSpace(result.Model), len(rows))
	return nil
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
