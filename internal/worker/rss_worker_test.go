package worker

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"

	"quick/internal/models"

	"github.com/mmcdole/gofeed"
)

func TestMapFeedItemToArticle_SanitizesNoise(t *testing.T) {
	item := &gofeed.Item{
		Title:       "AI&nbsp;News",
		Link:        "https://example.com/post/1",
		Description: "&#32; submitted by &#32; /u/gdelacalle [link] [comments]",
		Content:     "<p>Hello&nbsp;world</p>",
	}

	article, ok := mapFeedItemToArticle(1, item)
	if !ok {
		t.Fatalf("mapFeedItemToArticle should return ok")
	}
	if article.Title != "AI News" {
		t.Fatalf("article.Title=%q, want %q", article.Title, "AI News")
	}
	if article.Summary == nil || *article.Summary != "Hello world" {
		t.Fatalf("article.Summary=%v, want %q", article.Summary, "Hello world")
	}
	if article.Content == nil || *article.Content != "Hello world" {
		t.Fatalf("article.Content=%v, want %q", article.Content, "Hello world")
	}
}

func TestMapFeedItemToArticle_ExtractsReplyCount(t *testing.T) {
	item := &gofeed.Item{
		Title:       "Forum Topic",
		Link:        "https://example.com/t/100",
		Description: "This thread has 23 replies.",
	}

	article, ok := mapFeedItemToArticle(1, item)
	if !ok {
		t.Fatalf("mapFeedItemToArticle should return ok")
	}
	if article.ReplyCount == nil || *article.ReplyCount != 23 {
		t.Fatalf("article.ReplyCount=%v, want 23", article.ReplyCount)
	}
}

func TestIsRedditRSSURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "reddit host", input: "https://www.reddit.com/r/technology/top.rss?t=day", want: true},
		{name: "old reddit host", input: "https://old.reddit.com/r/golang/new.rss", want: true},
		{name: "hnrss host", input: "https://hnrss.org/frontpage", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRedditRSSURL(tt.input)
			if got != tt.want {
				t.Fatalf("isRedditRSSURL(%q)=%v, want=%v", tt.input, got, tt.want)
			}
		})
	}
}

func TestRetryAttemptsForSource(t *testing.T) {
	tests := []struct {
		name           string
		defaultRetries int
		rssURL         string
		want           int
	}{
		{
			name:           "non reddit keeps default retry attempts",
			defaultRetries: 2,
			rssURL:         "https://hnrss.org/frontpage",
			want:           3,
		},
		{
			name:           "reddit forces single attempt",
			defaultRetries: 2,
			rssURL:         "https://www.reddit.com/r/technology/top.rss?t=day",
			want:           1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := retryAttemptsForSource(tt.defaultRetries, tt.rssURL)
			if got != tt.want {
				t.Fatalf("retryAttemptsForSource(%d,%q)=%d, want=%d", tt.defaultRetries, tt.rssURL, got, tt.want)
			}
		})
	}
}

func TestRedditFallbackURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
		ok    bool
	}{
		{
			name:  "www reddit to old reddit",
			input: "https://www.reddit.com/r/technology/top.rss?t=day",
			want:  "https://old.reddit.com/r/technology/top.rss?t=day",
			ok:    true,
		},
		{
			name:  "plain reddit host",
			input: "https://reddit.com/r/golang/new.rss",
			want:  "https://old.reddit.com/r/golang/new.rss",
			ok:    true,
		},
		{
			name:  "already old reddit has no fallback",
			input: "https://old.reddit.com/r/golang/new.rss",
			want:  "",
			ok:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := redditFallbackURL(tt.input)
			if ok != tt.ok {
				t.Fatalf("redditFallbackURL(%q) ok=%v, want=%v", tt.input, ok, tt.ok)
			}
			if got != tt.want {
				t.Fatalf("redditFallbackURL(%q)=%q, want=%q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNewRSSWorker_DefaultUserAgent(t *testing.T) {
	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{
		TickSec: 30,
	})
	if worker.userAgent != "quick-rss-worker/0.1" {
		t.Fatalf("worker.userAgent=%q, want default quick-rss-worker/0.1", worker.userAgent)
	}
}

func TestNewRSSWorker_CustomUserAgent(t *testing.T) {
	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{
		TickSec:   30,
		UserAgent: "Mozilla/5.0 (compatible; QuickRSS/0.1; +https://urwhaturead.com/contact)",
	})
	if worker.userAgent != "Mozilla/5.0 (compatible; QuickRSS/0.1; +https://urwhaturead.com/contact)" {
		t.Fatalf("worker.userAgent=%q, want custom user agent", worker.userAgent)
	}
}

func TestNewRSSWorker_RedditClientDisablesHTTP2(t *testing.T) {
	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{
		TickSec: 30,
	})
	transport, ok := worker.redditHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("reddit transport type=%T, want *http.Transport", worker.redditHTTPClient.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("expected reddit transport ForceAttemptHTTP2=false")
	}
	if transport.TLSNextProto == nil {
		t.Fatalf("expected reddit transport TLSNextProto to disable http/2")
	}
	if transport.TLSClientConfig == nil || len(transport.TLSClientConfig.NextProtos) != 1 || transport.TLSClientConfig.NextProtos[0] != "http/1.1" {
		t.Fatalf("expected TLSClientConfig.NextProtos=[http/1.1], got=%v", transport.TLSClientConfig)
	}
}

func TestNormalizeDebugHosts(t *testing.T) {
	got := normalizeDebugHosts([]string{" reddit.com ", "REDDIT.com", "  ", "old.reddit.com"})
	if len(got) != 2 {
		t.Fatalf("normalizeDebugHosts len=%d, want=2 (%v)", len(got), got)
	}
	if got[0] != "reddit.com" || got[1] != "old.reddit.com" {
		t.Fatalf("normalizeDebugHosts got=%v, want=[reddit.com old.reddit.com]", got)
	}
}

func TestShouldDebugURL(t *testing.T) {
	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{
		TickSec:    30,
		DebugHTTP:  true,
		DebugHosts: []string{"reddit.com"},
	})
	if !worker.shouldDebugURL("https://www.reddit.com/r/technology/top.rss?t=day") {
		t.Fatalf("expected reddit url to be debug-enabled")
	}
	if worker.shouldDebugURL("https://hnrss.org/frontpage") {
		t.Fatalf("expected non-target host to be debug-disabled")
	}
}

func TestFetchOnceRejectsHTMLChallengeBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<!doctype html><html><body>request blocked</body></html>"))
	}))
	defer server.Close()

	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{TickSec: 30})
	worker.httpClient = server.Client()

	_, err := worker.fetchOnce(context.Background(), models.Source{
		ID:     1,
		RSSURL: server.URL + "/feed",
	})
	if err == nil {
		t.Fatalf("expected fetchOnce to reject html body")
	}
	var ferr fetchError
	if !errors.As(err, &ferr) {
		t.Fatalf("expected fetchError, got %T", err)
	}
	if ferr.Retryable {
		t.Fatalf("expected non-retryable error for blocked html response")
	}
	if ferr.StatusCode != http.StatusOK {
		t.Fatalf("ferr.StatusCode=%d, want=%d", ferr.StatusCode, http.StatusOK)
	}
	if !strings.Contains(strings.ToLower(ferr.Message), "non-feed") && !strings.Contains(strings.ToLower(ferr.Message), "blocked") {
		t.Fatalf("unexpected error message: %q", ferr.Message)
	}
}

func TestFetchOnceAcceptsXMLBodyEvenWithPlainTextContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title></channel></rss>`))
	}))
	defer server.Close()

	worker := NewRSSWorker(&gorm.DB{}, RSSWorkerOptions{TickSec: 30})
	worker.httpClient = server.Client()

	result, err := worker.fetchOnce(context.Background(), models.Source{
		ID:     2,
		RSSURL: server.URL + "/feed",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil || len(result.Body) == 0 {
		t.Fatalf("expected feed body in result")
	}
}
