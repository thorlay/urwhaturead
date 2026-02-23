package worker

import (
	"testing"

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
