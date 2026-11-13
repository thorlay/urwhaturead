package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"quick/internal/textclean"
)

func TestNGASavedRepliesBecomeReaderDiscussion(t *testing.T) {
	content := textclean.NormalizeFromHTMLBlock("[NGA 主帖]\nMain body\n[NGA 回复材料：部分楼层]\n\n楼层作者：Alice\n楼层链接：https://nga.178.com/read.php?tid=123#postcontent456\nDifferent opinion\n")
	article := articleDetail{Link: "https://nga.178.com/read.php?tid=123", Title: "Topic", SourceRSSURL: "http://hub:1200/rss/nga/forum/414", Content: &content}
	thread := ngaSavedDiscussion(article)
	if thread == nil || thread.FullContent != "Main body" || len(thread.Comments) != 1 || thread.Comments[0].Author != "Alice" || thread.Comments[0].Content != "Different opinion" {
		t.Fatalf("saved replies must appear separately from main HTML: %+v", thread)
	}
	if thread.FeedURL != "http://hub:1200/rss/nga/post/123" {
		t.Fatal(thread.FeedURL)
	}
	if !needsNGAThreadEnrichment(article.Link, articleEnrichmentResult{}) {
		t.Fatal("legacy empty enrichment must not hide newly supported replies")
	}
	if needsNGAThreadEnrichment(article.Link, articleEnrichmentResult{Thread: thread}) {
		t.Fatal("valid discussion cache should be reused")
	}
}

func TestNGAOnDemandRepliesUseConfiguredHub(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rss/nga/post/123" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, `<rss version="2.0"><channel><title>Topic</title><link>https://nga.178.com/read.php?tid=123</link><description>Topic</description>
<item><guid>postcontent0</guid><title>Main</title><link>https://nga.178.com/read.php?tid=123#postcontent0</link><description>Main body</description></item>
<item><guid>postcontent456</guid><title>Reply</title><link>https://nga.178.com/read.php?tid=123#postcontent456</link><author>Alice</author><description>Reply body</description></item>
</channel></rss>`)
	}))
	defer server.Close()
	s := NewArticleContentService(ArticleHandlerOptions{RSSHubBaseURL: server.URL + "/rss"})
	thread, ok := s.fetchThreadForTopic(context.Background(), "https://bbs.nga.cn/read.php?tid=123")
	if !ok || thread.FullContent != "Main body" || len(thread.Comments) != 1 || thread.Comments[0].Content != "Reply body" {
		t.Fatalf("expected main post and on-demand comments: %+v", thread)
	}
}
