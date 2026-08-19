package handlers

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"quick/internal/aisummary"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

func TestBriefingSnippet_CleansNoise(t *testing.T) {
	item := feedItem{
		Summary: stringPtr(`<p>&#32; submitted by &#32; /u/demo [link] [comments]</p><p>主要内容</p>`),
	}
	got := briefingSnippet(item)
	want := "主要内容"
	if got != want {
		t.Fatalf("briefingSnippet()=%q, want %q", got, want)
	}
}

func TestBuildFeedBriefingPrompt_IsContentTypeAware(t *testing.T) {
	items := []feedItem{
		{
			SourceName: "Blog",
			SourceTag:  "tech",
			Title:      "Why software teams need fewer dashboards",
			Link:       "https://example.com/essay",
			Summary:    stringPtr("作者认为团队应该减少仪表盘数量，集中在更少但更可靠的指标上。"),
		},
		{
			SourceName: "Forum",
			SourceTag:  "forum",
			Title:      "How do you manage RSS overload?",
			Link:       "https://example.com/thread",
			Summary:    stringPtr("讨论集中在过滤规则、AI 摘要和手动精选之间的取舍。"),
		},
	}

	prompt := buildFeedBriefingPrompt(items)
	for _, want := range []string{
		"信息条目",
		"不要默认按新闻稿方式总结",
		"essay_argument",
		"forum_discussion",
		"resource_tool",
		"长文论点与讨论焦点",
		"适合谁读",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("buildFeedBriefingPrompt() missing %q in prompt:\n%s", want, prompt)
		}
	}
}

func TestSanitizeFeedItems(t *testing.T) {
	items := []feedItem{
		{
			SourceName: " HN ",
			Title:      "AI&nbsp;News",
			Summary:    stringPtr(`submitted by /u/demo [link] [comments]`),
			Author:     stringPtr("  alice "),
		},
	}

	sanitizeFeedItems(items)

	if items[0].SourceName != "HN" {
		t.Fatalf("SourceName=%q, want %q", items[0].SourceName, "HN")
	}
	if items[0].Title != "AI News" {
		t.Fatalf("Title=%q, want %q", items[0].Title, "AI News")
	}
	if items[0].Summary != nil {
		t.Fatalf("Summary=%v, want nil", items[0].Summary)
	}
	if items[0].Author == nil || *items[0].Author != "alice" {
		t.Fatalf("Author=%v, want %q", items[0].Author, "alice")
	}
}

func TestSanitizeFeedItems_FillsReplyCountFromRaw(t *testing.T) {
	items := []feedItem{
		{
			SourceName: "Forum",
			Title:      "Topic",
			Raw:        datatypes.JSON([]byte(`{"description":"评论: 11"}`)),
		},
	}

	sanitizeFeedItems(items)

	if items[0].ReplyCount == nil || *items[0].ReplyCount != 11 {
		t.Fatalf("ReplyCount=%v, want 11", items[0].ReplyCount)
	}
}

func TestBuildFeedBriefingInputItems(t *testing.T) {
	now := time.Now().UTC()
	rows := []feedItem{
		{
			ID:          101,
			SourceID:    7,
			SourceName:  " HN ",
			Title:       "  First  ",
			Link:        "https://example.com/a",
			PublishedAt: &now,
		},
		{
			ID:         102,
			SourceID:   8,
			SourceName: " V2EX ",
			Title:      "",
		},
	}

	got := buildFeedBriefingInputItems(rows, 10)
	if len(got) != 2 {
		t.Fatalf("len(got)=%d, want 2", len(got))
	}
	if got[0].ID != 101 || got[0].SourceID != 7 {
		t.Fatalf("got[0] id/source=(%d,%d), want (101,7)", got[0].ID, got[0].SourceID)
	}
	if got[0].SourceName != "HN" {
		t.Fatalf("got[0].SourceName=%q, want %q", got[0].SourceName, "HN")
	}
	if got[0].Title != "First" {
		t.Fatalf("got[0].Title=%q, want %q", got[0].Title, "First")
	}
	if got[1].Title != "文章 #102" {
		t.Fatalf("got[1].Title=%q, want %q", got[1].Title, "文章 #102")
	}
}

func TestDedupeFeedBriefingRows(t *testing.T) {
	clusterA := uint64(9)
	clusterB := uint64(12)
	rows := []feedItem{
		{ID: 101, ClusterID: &clusterA, Title: "A newest"},
		{ID: 102, ClusterID: &clusterA, Title: "A older"},
		{ID: 103, ClusterID: nil, Title: "No cluster"},
		{ID: 104, ClusterID: &clusterB, Title: "B newest"},
		{ID: 105, ClusterID: &clusterB, Title: "B older"},
	}

	got := dedupeFeedBriefingRows(rows)
	if len(got) != 3 {
		t.Fatalf("len(got)=%d, want 3", len(got))
	}
	if got[0].ID != 101 {
		t.Fatalf("got[0].ID=%d, want 101", got[0].ID)
	}
	if got[1].ID != 103 {
		t.Fatalf("got[1].ID=%d, want 103", got[1].ID)
	}
	if got[2].ID != 104 {
		t.Fatalf("got[2].ID=%d, want 104", got[2].ID)
	}
}

func TestFeedDedupeCandidateLimit(t *testing.T) {
	tests := []struct {
		limit int
		want  int
	}{
		{limit: 20, want: 300},
		{limit: 100, want: 800},
	}

	for _, tt := range tests {
		if got := feedDedupeCandidateLimit(tt.limit); got != tt.want {
			t.Fatalf("feedDedupeCandidateLimit(%d)=%d, want %d", tt.limit, got, tt.want)
		}
	}
}

func TestBriefingRateLimiter_AllowAndBlock(t *testing.T) {
	limiter := newBriefingRateLimiter(2, 10*time.Minute)
	now := time.Now().UTC()

	if _, ok := limiter.Allow("key", now); !ok {
		t.Fatalf("first request should pass")
	}
	if _, ok := limiter.Allow("key", now.Add(1*time.Second)); !ok {
		t.Fatalf("second request should pass")
	}
	retry, ok := limiter.Allow("key", now.Add(2*time.Second))
	if ok {
		t.Fatalf("third request should be blocked")
	}
	if retry <= 0 {
		t.Fatalf("retry should be positive, got=%s", retry)
	}
}

func TestBriefingCooldownStore(t *testing.T) {
	store := newBriefingCooldownStore(5 * time.Minute)
	now := time.Now().UTC()
	store.Touch("digest", now)

	if _, ok := store.Allow("digest", now.Add(2*time.Minute)); ok {
		t.Fatalf("cooldown should block within window")
	}
	if _, ok := store.Allow("digest", now.Add(6*time.Minute)); !ok {
		t.Fatalf("cooldown should allow after window")
	}
}

func TestFeedHandler_IsAdminRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &FeedHandler{
		adminAuthEnabled: true,
		adminToken:       "abc123",
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/v1/feed/briefing", nil)
	c.Request.Header.Set("Authorization", "Bearer abc123")

	if !handler.isAdminRequest(c) {
		t.Fatalf("expected admin request to pass")
	}
}

func TestBuildFeedBriefingDigest_KeywordCaseInsensitive(t *testing.T) {
	rows := []feedItem{
		{ID: 11, SourceID: 1, Title: "A"},
		{ID: 12, SourceID: 2, Title: "B"},
	}
	keyA, _ := buildFeedBriefingDigest(20, "tech", "AI", "gemini-2.5-flash", []uint64{2, 1}, rows)
	keyB, _ := buildFeedBriefingDigest(20, "tech", "ai", "gemini-2.5-flash", []uint64{1, 2}, rows)
	if keyA != keyB {
		t.Fatalf("digest should be case-insensitive for keyword: %s != %s", keyA, keyB)
	}
}

func TestResolveFeedBriefingModel_DefaultFallback(t *testing.T) {
	summarizer := aisummary.NewClient(aisummary.Options{
		BaseURL: "http://example.com/v1/messages",
		APIKey:  "secret",
		Model:   "gemini-2.5-flash",
	})
	if summarizer == nil {
		t.Fatalf("summarizer should not be nil")
	}
	got := resolveFeedBriefingModel("", summarizer, true)
	if got != "gemini-2.5-flash" {
		t.Fatalf("resolveFeedBriefingModel fallback=%q, want %q", got, "gemini-2.5-flash")
	}
}

func TestResolveFeedBriefingModel_NonAdminLocked(t *testing.T) {
	summarizer := aisummary.NewClient(aisummary.Options{
		BaseURL: "http://example.com/v1/messages",
		APIKey:  "secret",
		Model:   "gemini-2.5-pro",
	})
	if summarizer == nil {
		t.Fatalf("summarizer should not be nil")
	}
	got := resolveFeedBriefingModel("gemini-2.5-flash", summarizer, false)
	if got != "gemini-2.5-pro" {
		t.Fatalf("resolveFeedBriefingModel non-admin=%q, want configured default", got)
	}
}
