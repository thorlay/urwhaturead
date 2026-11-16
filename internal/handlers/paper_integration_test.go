package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/aisummary"
	"quick/internal/models"
)

func TestPaperFeedsDailyDigestAndChannelIsolation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	schema := fmt.Sprintf("paper_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	db, err = gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	scoped, _ := db.DB()
	defer scoped.Close()
	if err := db.AutoMigrate(&models.Source{}, &models.Article{}, &models.FeedBriefing{}, &models.ArticleEnrichment{}, &models.ArticleHighlight{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE event_clusters(id bigint,article_count integer)").Error; err != nil {
		t.Fatal(err)
	}
	sourceHandler := NewSourceHandlerWithOptions(db, nil, SourceHandlerOptions{RSSHubBaseURL: "http://rsshub:1200"})
	feeds, err := sourceHandler.EnsurePaperSources(context.Background())
	if err != nil || len(feeds) != 2 {
		t.Fatalf("sources: %v %v", feeds, err)
	}
	again, err := sourceHandler.EnsurePaperSources(context.Background())
	if err != nil || again[0].ID != feeds[0].ID {
		t.Fatal("paper source setup must be repeatable")
	}
	now := time.Now().UTC()
	abstract := "Research abstract"
	for i := 0; i < 7; i++ {
		paperID := i
		if i == 6 {
			paperID = 0
		}
		sourceID := feeds[0].ID
		if i == 6 {
			sourceID = feeds[1].ID
		}
		raw := fmt.Sprintf(`{"extensions":{"quick":{"paperVotes":[{"value":"%d"}],"paperSeenAt":[{"value":"%s"}]}}}`, 100-i, now.Format(time.RFC3339))
		row := models.Article{SourceID: sourceID, Title: fmt.Sprintf("Paper %d", paperID), Link: fmt.Sprintf("https://arxiv.org/abs/2611.%05d", paperID+10000), Content: &abstract, ContentHash: fmt.Sprintf("paper-%d", i), Raw: datatypes.JSON(raw), CreatedAt: now, PublishedAt: &now}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		evidence := articleExternalContent{Content: "[论文正文节选]\nMethod: retrieval. Evidence: controlled baseline. Limitation: only English. Code https://github.com/lab/method"}
		data, _ := json.Marshal(evidence)
		if err := db.Create(&models.ArticleEnrichment{ArticleID: row.ID, External: data, FetchedAt: now, UpdatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := newFeedRepository(db)
	papers, e := repo.list(context.Background(), feedListParams{channel: "papers", limit: 20})
	if e != nil || len(papers.rows) != 6 || papers.rows[0].PaperVotes == nil || *papers.rows[0].PaperVotes != 100 {
		t.Fatalf("ranking/dedupe: %+v %v", papers, e)
	}
	page, e := repo.list(context.Background(), feedListParams{channel: "papers", limit: 1, cursor: &feedCursor{ID: papers.rows[0].ID, SortTime: papers.rows[0].SortTime, Replies: papers.rows[0].PaperVotes}})
	if e != nil || len(page.rows) != 2 || *page.rows[0].PaperVotes != 99 {
		t.Fatalf("paper cursor: %+v %v", page, e)
	}
	news, e := repo.list(context.Background(), feedListParams{channel: "news", limit: 20})
	if e != nil || len(news.rows) != 0 {
		t.Fatal("papers must be separate from news", e)
	}
	var calls atomic.Int32
	var truncate atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		var request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&request)
		content := "# 论文精选\\n关键方法、证据和局限 [A01]"
		if len(request.Messages) > 0 && strings.Contains(request.Messages[0].Content, "选稿助手") {
			content = `{\"ids\":[\"A01\",\"A02\",\"A03\",\"A04\"]}`
		}
		finish := "stop"
		if truncate.Load() && !strings.Contains(request.Messages[0].Content, "选稿助手") {
			finish = "length"
		}
		fmt.Fprintf(w, `{"choices":[{"message":{"content":"%s"},"finish_reason":"%s"}]}`, content, finish)
	}))
	defer server.Close()
	client := aisummary.NewClient(aisummary.Options{BaseURL: server.URL + "/v1/chat/completions", APIKey: "test", Model: "test", APIStyle: "openai_chat"})
	h := NewFeedHandler(db, client, FeedHandlerOptions{})
	rows, err := h.queryBriefingFeedRows(context.Background(), 30, "papers", "", nil, nil)
	if err != nil || len(rows) != 6 {
		t.Fatalf("candidates: %d %v", len(rows), err)
	}
	input := feedBriefingTaskInput{DailyPaper: true, DigestKey: dailyPaperDigest(now), Tag: "papers", Model: "test", Limit: 30}
	report, err := h.generateAndSaveFeedBriefing(context.Background(), input, rows, nil)
	if err != nil || report.ArticleCount != 4 || !strings.Contains(report.Summary, "https://github.com/lab/method") {
		t.Fatalf("daily report: %+v %v", report, err)
	}
	if err := db.Model(&models.FeedBriefing{}).Where("digest_key=?", input.DigestKey).Update("truncated", true).Error; err != nil {
		t.Fatal(err)
	}
	input.Refresh = true
	if _, err := h.generateAndSaveFeedBriefing(context.Background(), input, rows, nil); err != nil {
		t.Fatal(err)
	}
	var repaired models.FeedBriefing
	db.Where("digest_key=?", input.DigestKey).First(&repaired)
	if repaired.Truncated {
		t.Fatal("a complete regeneration must clear an old truncation flag")
	}
	input.Refresh = false
	before := calls.Load()
	cached, err := h.generateAndSaveFeedBriefing(context.Background(), input, rows, nil)
	if err != nil || !cached.CacheHit || calls.Load() != before {
		t.Fatal("same-day report must be reused", err)
	}
	var stored models.FeedBriefing
	db.First(&stored)
	db.Model(&stored).Update("generated_at", paperDayStart(now).Add(-time.Hour))
	fresh, err := h.queryBriefingFeedRows(context.Background(), 30, "papers", "", nil, nil)
	if err != nil || len(fresh) != 2 {
		t.Fatalf("next-day shortlist must skip already featured papers across both boards: %d %v", len(fresh), err)
	}
	truncate.Store(true)
	input.Refresh = true
	if _, err := h.generateAndSaveFeedBriefing(context.Background(), input, rows, nil); err == nil {
		t.Fatal("truncated paper output must not be published after retry")
	}
	var retained models.FeedBriefing
	db.First(&retained, stored.ID)
	if retained.Summary != stored.Summary {
		t.Fatal("failed regeneration must preserve the existing complete report")
	}

}
