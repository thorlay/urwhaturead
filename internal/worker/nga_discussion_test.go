package worker

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mmcdole/gofeed"
	"quick/internal/models"
)

func TestNGADiscussionUsesSourceHubAndPreservesAuthors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxy/nga/post/123" {
			t.Errorf("unexpected reply destination: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, `<rss version="2.0"><channel><title>Thread</title><description>Test</description><link>https://nga.178.com/read.php?tid=123</link>
<item><guid>postcontent0</guid><link>https://nga.178.com/read.php?tid=123#postcontent0</link><description>Main</description></item>
<item><guid>postcontent456</guid><link>https://nga.178.com/read.php?tid=123#postcontent456</link><author>Alice</author><description>Different opinion</description></item>
</channel></rss>`)
	}))
	defer server.Close()
	w := NewRSSWorker(nil, RSSWorkerOptions{})
	item := &gofeed.Item{Link: "https://nga.178.com/read.php?tid=123", Description: "Main"}
	w.enrichNGAFeedDiscussions(context.Background(), models.Source{RSSURL: server.URL + "/proxy/nga/forum/414"}, &gofeed.Feed{Items: []*gofeed.Item{item}})
	for _, want := range []string{"[NGA 主帖]", "[NGA 回复材料", "Alice", "Different opinion", "#postcontent456"} {
		if !strings.Contains(item.Content, want) {
			t.Fatalf("missing %s: %s", want, item.Content)
		}
	}
	first, _ := mapFeedItemToArticle(1, item)
	item.Content += "New reply"
	second, _ := mapFeedItemToArticle(1, item)
	if first.ContentHash == second.ContentHash {
		t.Fatal("new replies must update the revision even if the main post is unchanged")
	}
	second.Content = first.Summary
	if _, exists := existingArticleDiscussionUpdates(second)["content"]; exists {
		t.Fatal("a failed reply refresh must preserve existing discussion content")
	}
}

func TestNGABoardPollDoesNotSkipReplyRefreshWithConditionalHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") != "" || r.Header.Get("If-Modified-Since") != "" {
			t.Error("unchanged board RSS must not suppress checking new replies")
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, `<rss version="2.0"><channel><title>Board</title><description>Test</description><link>https://nga.178.com/</link></channel></rss>`)
	}))
	defer server.Close()
	etag, modified := "old", "Wed, 11 Nov 2026 00:00:00 GMT"
	w := NewRSSWorker(nil, RSSWorkerOptions{})
	if _, err := w.fetchOnce(context.Background(), models.Source{RSSURL: server.URL + "/nga/forum/414", ETag: &etag, LastModified: &modified}); err != nil {
		t.Fatal(err)
	}
}
