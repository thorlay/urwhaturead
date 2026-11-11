package handlers

import (
	"context"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"quick/internal/models"
	"quick/internal/textclean"
)

var highlightCitation = regexp.MustCompile(`\[A(\d{1,3})\]`)
var highlightHeading = regexp.MustCompile(`^#{1,6}\s+`)

func briefingHighlights(record models.FeedBriefing) []models.ArticleHighlight {
	if record.StopReason == "max_tokens" || record.StopReason == "length" {
		return nil
	}
	ids := parseCSVUint64OrderedLoose(record.ArticleIDs)
	var result []models.ArticleHighlight
	active := false
	seen := map[uint64]bool{}
	for _, line := range strings.Split(record.Summary, "\n") {
		line = strings.TrimSpace(line)
		heading := highlightHeading.MatchString(line)
		if heading {
			active = strings.Contains(line, "优先阅读") || strings.Contains(line, "值得深读")
			continue
		}
		if !active {
			continue
		}
		citation := highlightCitation.FindStringSubmatchIndex(line)
		if citation == nil {
			continue
		}
		index, err := strconv.Atoi(line[citation[2]:citation[3]])
		if err != nil || index < 1 || index > len(ids) || seen[ids[index-1]] {
			continue
		}
		tail := strings.TrimSpace(line[citation[1]:])
		// A recommendation must include an explicit reason, not just a cited title.
		tail = strings.TrimLeft(tail, "* _：:—–-｜|\t")
		reason := textclean.NormalizeInline(tail)
		if len([]rune(reason)) < 6 || strings.HasPrefix(reason, "http") {
			continue
		}
		reason = truncateFeedText(reason, 160)
		seen[ids[index-1]] = true
		result = append(result, models.ArticleHighlight{ArticleID: ids[index-1], Reason: reason, GeneratedAt: record.GeneratedAt})
		if len(result) == 4 {
			break
		}
	}
	return result
}

func saveArticleHighlights(ctx context.Context, db *gorm.DB, record models.FeedBriefing) error {
	rows := briefingHighlights(record)
	if len(rows) == 0 {
		return nil
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "article_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"reason", "generated_at"}),
		Where:     clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "article_highlights.generated_at <= EXCLUDED.generated_at"}}},
	}).Create(&rows).Error
}

// BackfillArticleHighlights runs off the request path and makes recent cached reports usable.
func BackfillArticleHighlights(ctx context.Context, db *gorm.DB) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	var records []models.FeedBriefing
	if err := db.WithContext(ctx).Where("generated_at >= ?", time.Now().Add(-72*time.Hour)).Order("generated_at DESC").Limit(200).Find(&records).Error; err != nil {
		log.Printf("highlight backfill failed: %v", err)
		return
	}
	for _, record := range records {
		if err := saveArticleHighlights(ctx, db, record); err != nil {
			log.Printf("highlight backfill failed: %v", err)
			return
		}
	}
}
