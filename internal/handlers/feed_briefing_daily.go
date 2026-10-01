package handlers

import (
	"context"
	"crypto/sha1"
	"fmt"
	"time"

	"quick/internal/models"
)

// The existing unique digest index also enforces one report per source/local day.
func dailyBriefingDigest(sourceID uint64, now time.Time, location *time.Location) string {
	if location == nil {
		location = time.UTC
	}
	return fmt.Sprintf("%x", sha1.Sum([]byte(fmt.Sprintf("daily-source:%d:%s", sourceID, now.In(location).Format("2006-01-02")))))
}

func dailyBriefingLockID(sourceID uint64) int64 {
	return -int64(sourceID) - 1000000
}

func dailyBriefingDue(source models.Source, now time.Time, location *time.Location, minute int) bool {
	if location == nil {
		location = time.UTC
	}
	local := now.In(location)
	if local.Hour()*60+local.Minute() < minute {
		return false
	}
	if source.AIBriefingLastGeneratedAt != nil && source.AIBriefingLastGeneratedAt.In(location).Format("2006-01-02") == local.Format("2006-01-02") {
		return false
	}
	return source.AIBriefingLastRunAt == nil || now.Sub(*source.AIBriefingLastRunAt) >= 10*time.Minute
}

func (h *FeedHandler) cachedBriefingRefs(ctx context.Context, record models.FeedBriefing) (map[string][]feedBriefingInputItem, error) {
	records := []models.FeedBriefing{record}
	names, err := h.loadSourceNamesForBriefings(ctx, records)
	if err != nil {
		return nil, err
	}
	return h.loadArticleRefsForBriefings(ctx, records, names)
}
