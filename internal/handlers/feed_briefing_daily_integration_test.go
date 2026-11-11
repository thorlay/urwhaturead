package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/aisummary"
	"quick/internal/models"
)

func TestDailyBriefingPersistence(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN is required for PostgreSQL integration")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	schema := fmt.Sprintf("daily_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	scoped, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	scopedSQL, _ := scoped.DB()
	defer scopedSQL.Close()
	for _, statement := range []string{
		`CREATE TABLE sources (id bigint PRIMARY KEY, name text, tags text[], enabled boolean, ai_briefing_enabled boolean, ai_briefing_last_run_at timestamptz, ai_briefing_last_generated_at timestamptz, updated_at timestamptz)`,
		`CREATE TABLE articles (id bigint PRIMARY KEY, source_id bigint, cluster_id bigint, title text, link text, summary text, content text, author text, published_at timestamptz, image_url text, reply_count integer, content_hash text, created_at timestamptz)`,
		`INSERT INTO sources VALUES (1, 'Test', ARRAY['tech'], true, true, NULL, NULL, now())`,
		`INSERT INTO articles (id, source_id, title, summary, created_at) VALUES (1, 1, 'First', 'Content', now()), (2, 1, 'Second', 'Content', now())`,
	} {
		if err := scoped.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := scoped.AutoMigrate(&models.FeedBriefing{}, &models.FeedBriefingArticle{}, &models.ArticleEnrichment{}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	var fail atomic.Bool
	fail.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if fail.Load() {
			w.WriteHeader(400)
			fmt.Fprint(w, `{"error":{"message":"test failure"}}`)
			return
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Daily report"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	client := aisummary.NewClient(aisummary.Options{BaseURL: server.URL + "/v1/chat/completions", APIKey: "test", Model: "test", APIStyle: "openai_chat"})
	scheduler := NewFeedBriefingScheduler(scoped, client, FeedBriefingSchedulerOptions{Timezone: "UTC", DailyTime: "00:00", Limit: 1})
	now := time.Now().UTC()
	source := models.Source{ID: 1}
	ctx := context.Background()
	if err := scheduler.runSourceBriefing(ctx, source, now); err == nil {
		t.Fatal("expected upstream failure")
	}
	var count int64
	scoped.Model(&models.FeedBriefing{}).Count(&count)
	if count != 0 {
		t.Fatal("failed generation persisted a report")
	}
	fail.Store(false)
	scoped.Exec("UPDATE sources SET ai_briefing_last_run_at = NULL")
	lock := scoped.Begin()
	if err := lock.Exec("SELECT pg_advisory_xact_lock(?)", dailyBriefingLockID(1)).Error; err != nil {
		t.Fatal(err)
	}
	beforeLock := calls.Load()
	if err := scheduler.runSourceBriefing(ctx, source, now); err != nil {
		t.Fatal(err)
	}
	lock.Rollback()
	if calls.Load() != beforeLock {
		t.Fatal("concurrent lock holder must prevent duplicate model call")
	}

	if err := scheduler.runSourceBriefing(ctx, source, now); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	if err := scheduler.runSourceBriefing(ctx, source, now); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != before {
		t.Fatal("same day repeated model request")
	}
	scoped.Model(&models.FeedBriefing{}).Count(&count)
	if count != 1 {
		t.Fatalf("reports=%d, want 1", count)
	}
	handler := &FeedHandler{db: scoped, summarizer: client, briefingCooldown: newBriefingCooldownStore(time.Minute)}
	rows, err := handler.queryBriefingFeedRows(ctx, 1, "", "", []uint64{1}, []uint64{1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = handler.generateAndSaveFeedBriefing(ctx, feedBriefingTaskInput{DigestKey: dailyBriefingDigest(1, now, time.UTC), DailySource: true, Refresh: true, SourceIDs: []uint64{1}, ArticleIDs: []uint64{1}, Model: "test", Limit: 1}, rows, nil)
	if err != nil {
		t.Fatal(err)
	}
	scoped.Model(&models.FeedBriefing{}).Count(&count)
	if count != 1 {
		t.Fatal("manual refresh created a duplicate report")
	}
	beforeCache := calls.Load()
	payload, err := handler.generateAndSaveFeedBriefing(ctx, feedBriefingTaskInput{DigestKey: dailyBriefingDigest(1, now, time.UTC), DailySource: true, SourceIDs: []uint64{1}, ArticleIDs: []uint64{2}, Model: "another-model", Limit: 1}, []feedItem{{ID: 2}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !payload.CacheHit || calls.Load() != beforeCache || len(payload.InputItems) != 1 || payload.InputItems[0].ID != 1 || payload.InputItems[0].SourceName != "Test" {
		t.Fatal("cache must return original report references without a model call")
	}
	if err := scheduler.runSourceBriefing(ctx, source, now.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	scoped.Model(&models.FeedBriefing{}).Count(&count)
	if count != 2 {
		t.Fatalf("next day reports=%d, want 2", count)
	}
	var reports []models.FeedBriefing
	scoped.Order("id").Find(&reports)
	if reports[0].ArticleIDs == reports[1].ArticleIDs {
		t.Fatal("next day repeated already summarized article")
	}
	if err := scoped.AutoMigrate(&models.ArticleHighlight{}); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`ALTER TABLE sources ADD COLUMN kind text DEFAULT 'feed', ADD COLUMN hidden_in_sidebar boolean DEFAULT false`,
		`CREATE TABLE event_clusters (id bigint PRIMARY KEY, article_count bigint)`,
		`INSERT INTO articles(id,source_id,title,created_at) VALUES(3,1,'Third',now()),(4,1,'Fourth',now())`,
	} {
		if err := scoped.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	recommendation := models.FeedBriefing{ArticleIDs: "1,2,3,4", GeneratedAt: now, Summary: "## 优先阅读\n- First [A01] — 提供独立的实验数据和证据。\n- Second [A02] — 解释技术变化带来的实际影响。\n- Third [A03] — 分析不同方案之间的关键取舍。\n- Fourth [A04] — 介绍新的方法与适用边界。"}
	if err := saveArticleHighlights(ctx, scoped, recommendation); err != nil {
		t.Fatal(err)
	}
	repository := newFeedRepository(scoped)
	important, queryErr := repository.list(ctx, feedListParams{important: true, limit: 15})
	if queryErr != nil {
		t.Fatal(queryErr.cause)
	}
	if len(important.rows) != 3 || important.rows[0].HighlightReason == "" {
		t.Fatalf("source cap/reasons failed: %+v", important.rows)
	}
	filtered, queryErr := repository.list(ctx, feedListParams{important: true, limit: 15, keyword: "First", sourceIDs: []uint64{1}, tag: "tech"})
	if queryErr != nil {
		t.Fatal(queryErr.cause)
	}
	if len(filtered.rows) != 1 || filtered.rows[0].ID != 1 {
		t.Fatalf("filters failed: %+v", filtered.rows)
	}
	if err := scoped.Model(&models.ArticleHighlight{}).Where("article_id = ?", 1).Update("generated_at", now.Add(-96*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	filtered, queryErr = repository.list(ctx, feedListParams{important: true, limit: 15, keyword: "First"})
	if queryErr != nil || len(filtered.rows) != 0 {
		t.Fatal("expired recommendation remained visible")
	}
}
