package handlers

import (
	"context"
	"crypto/sha1"
	"fmt"
	"log"
	"os"
	"quick/internal/feedextract"
	"time"

	"gorm.io/gorm"
	"quick/internal/models"
)

const dailyPaperLock int64 = -970117

func paperSchedule() (*time.Location, int) {
	zone := os.Getenv("PAPER_BRIEFING_TIMEZONE")
	if zone == "" {
		zone = "America/Los_Angeles"
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	clock := os.Getenv("PAPER_BRIEFING_DAILY_TIME")
	if clock == "" {
		clock = "08:00"
	}
	minute, err := parseScheduleMinute(clock, false)
	if err != nil {
		minute = 8 * 60
	}
	return loc, minute
}
func dailyPaperDigest(now time.Time) string {
	loc, _ := paperSchedule()
	return fmt.Sprintf("%x", sha1.Sum([]byte("paper-daily-v1:"+now.In(loc).Format("2006-01-02"))))
}

func (s *FeedBriefingScheduler) runDailyPapers(ctx context.Context, now time.Time) {
	loc, minute := paperSchedule()
	local := now.In(loc)
	if local.Hour()*60+local.Minute() < minute {
		return
	}
	// Persist retry backoff across process restarts without creating empty reports.
	var anchor models.Source
	if err := s.db.WithContext(ctx).Where("enabled=true AND tags @> ARRAY['papers']::text[]").Order("id").First(&anchor).Error; err != nil {
		return
	}
	if anchor.AIBriefingLastRunAt != nil && now.Sub(*anchor.AIBriefingLastRunAt) < 10*time.Minute {
		return
	}
	digest := dailyPaperDigest(now)
	var count int64
	if s.db.WithContext(ctx).Model(&models.FeedBriefing{}).Where("digest_key=?", digest).Count(&count).Error != nil || count > 0 {
		return
	}
	bounded, cancel := context.WithTimeout(ctx, feedBriefingTaskTimeout)
	defer cancel()
	if err := s.db.Model(&models.Source{}).Where("id=?", anchor.ID).Update("ai_briefing_last_run_at", now).Error; err != nil {
		return
	}
	rows, err := s.helper.queryBriefingFeedRows(bounded, 30, "papers", "", nil, nil)
	if err != nil || len(rows) == 0 {
		return
	}
	model := resolveFeedBriefingModel("", s.summarizer, true)
	input := feedBriefingTaskInput{DailyPaper: true, DigestKey: digest, Tag: "papers", Limit: 30, Model: model, ArticleIDs: feedItemIDs(rows)}
	h := &FeedHandler{db: s.db, summarizer: s.summarizer, briefingCooldown: newBriefingCooldownStore(time.Minute)}
	if _, err = h.generateAndSaveFeedBriefing(bounded, input, rows, nil); err != nil {
		log.Printf("daily paper briefing failed: %v", err)
	}
}

func (h *FeedHandler) generateDailyPaper(ctx context.Context, input feedBriefingTaskInput, rows []feedItem) (feedBriefingPayload, error) {
	var payload feedBriefingPayload
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", dailyPaperLock).Error; err != nil {
			return err
		}
		var record models.FeedBriefing
		found := tx.Where("digest_key=?", input.DigestKey).Limit(1).Find(&record)
		if found.Error != nil {
			return found.Error
		}
		copy := *h
		copy.db = tx
		if found.RowsAffected > 0 && !input.Refresh {
			refs, err := copy.cachedBriefingRefs(ctx, record)
			if err != nil {
				return err
			}
			payload = feedBriefingPayload{DigestKey: record.DigestKey, Summary: record.Summary, Model: record.Model, Provider: record.Provider, GeneratedAt: record.GeneratedAt, CacheHit: true, ArticleCount: countCSVEntries(record.ArticleIDs), InputItems: refs[record.DigestKey]}
			return nil
		}
		var err error
		payload, err = copy.saveGeneratedFeedBriefing(ctx, input, rows, nil)
		return err
	})
	return payload, err
}

func paperDayStart(now time.Time) time.Time {
	loc, _ := paperSchedule()
	day := now.In(loc)
	return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
}

// Resolve a small set of covered article IDs with the primary-key index. Casting
// the entire article table to text for a coverage join is prohibitively slow.
func (h *FeedHandler) previouslyFeaturedPapers(ctx context.Context, now time.Time) ([]string, error) {
	var reports []string
	if err := h.db.WithContext(ctx).Model(&models.FeedBriefing{}).Where("tag='papers' AND generated_at >= ? AND generated_at < ?", now.Add(-7*24*time.Hour), paperDayStart(now)).Limit(500).Pluck("article_ids", &reports).Error; err != nil {
		return nil, err
	}
	var ids []uint64
	for _, report := range reports {
		ids = append(ids, parseCSVUint64Loose(report)...)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var links []string
	if err := h.db.WithContext(ctx).Model(&models.Article{}).Where("id IN ?", uniqueSortedUint64(ids)).Pluck("link", &links).Error; err != nil {
		return nil, err
	}
	for i := range links {
		if id, ok := feedextract.ArxivID(links[i]); ok {
			links[i] = "https://arxiv.org/abs/" + id
		}
	}
	return links, nil
}
