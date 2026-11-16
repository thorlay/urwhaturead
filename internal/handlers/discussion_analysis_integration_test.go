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

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/aisummary"
	"quick/internal/aitask"
	"quick/internal/models"
)

func TestDiscussionAnalysisCacheScopeAndSummaryIsolation(t *testing.T) {
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
	schema := fmt.Sprintf("discussion_test_%d", time.Now().UnixNano())
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
	if err := db.AutoMigrate(&models.Source{}, &models.Article{}, &models.ArticleSummary{}, &models.DiscussionAnalysis{}, &models.AITask{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.ArticleSummary{ArticleID: 1, Summary: "ordinary summary", Model: "test", GeneratedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		answer := discussionJudgment{Assessment: "存在围绕适用条件的分歧", Focus: []discussionClaim{{Point: "价格还是时间更重要", Evidence: []string{"R01", "R02"}}}, Perspectives: []discussionClaim{{Point: "有人重视效率", Evidence: []string{"R01"}}, {Point: "有人认为成本过高", Evidence: []string{"R02"}}}, Causes: []discussionClaim{{Point: "使用频率不同", Inference: true, Evidence: []string{"R01", "R02"}}}, Limits: "只有部分回复"}
		content, _ := json.Marshal(answer)
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}, "finish_reason": "stop"}}})
	}))
	defer server.Close()
	client := aisummary.NewClient(aisummary.Options{BaseURL: server.URL + "/v1/chat/completions", APIKey: "test", Model: "test", APIStyle: "openai_chat"})
	service := newDiscussionAnalysisService(db, client)
	input := discussionInput{ArticleID: 1, Title: "A forum question", Model: "test", Revision: "base-v1", References: []discussionReference{{ID: "R01", Author: "Alice", Link: "https://v2ex.com/t/123#reply1", Content: "Saves time"}, {ID: "R02", Author: "Bob", Link: "https://v2ex.com/t/123#reply2", Content: "Too expensive"}}, Sample: discussionSample{Available: 20, Analyzed: 2, Partial: true, ReadAt: time.Now()}}
	raw, _ := json.Marshal(input)
	hash := discussionInputHash(input)
	if err := service.run(context.Background(), aitask.Task{Key: discussionTaskPrefix(1) + hash, ResourceID: 1, Payload: string(raw)}); err != nil {
		t.Fatal(err)
	}
	cached, found, err := service.cached(context.Background(), 1, "base-v1")
	if err != nil || !found || !cached.CacheHit || cached.Sample.Available != 20 || len(cached.References) != 2 || !strings.Contains(cached.Summary, "#reply2") {
		t.Fatalf("cache: %+v %t %v", cached, found, err)
	}
	var ordinary models.ArticleSummary
	db.Where("article_id=1").First(&ordinary)
	if ordinary.Summary != "ordinary summary" {
		t.Fatal("discussion analysis overwrote ordinary summary")
	}
	if _, found, err := service.cached(context.Background(), 1, "base-v2"); err != nil || found {
		t.Fatal("reply revision changes must invalidate the cache")
	}
	db.Model(&models.DiscussionAnalysis{}).Where("article_id=1").Update("generated_at", time.Now().Add(-16*time.Minute))
	if _, found, err := service.cached(context.Background(), 1, "base-v1"); err != nil || found {
		t.Fatal("analysis cache must expire")
	}
	source := models.Source{Name: "Forum", RSSURL: "https://example.com/forum.rss", Tags: models.StringArray{"forum"}, Kind: "feed", Enabled: true}
	db.Create(&source)
	article := models.Article{SourceID: source.ID, Title: "No accessible replies", Link: "https://example.com/thread", ContentHash: "none"}
	db.Create(&article)
	handler := NewArticleHandler(db, client)
	router := gin.New()
	handler.RegisterReadRoutes(router.Group("/articles"))
	before := calls.Load()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", fmt.Sprintf("/articles/%d/discussion-analysis", article.ID), nil))
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "回复材料不足") || calls.Load() != before {
		t.Fatalf("insufficient evidence must not call AI: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", fmt.Sprintf("/articles/%d/discussion-analysis?task_key=%s", article.ID, discussionTaskPrefix(999)+strings.Repeat("a", 64)), nil))
	if rec.Code != 400 {
		t.Fatal("task results must be bound to the original article", rec.Code)
	}
}
