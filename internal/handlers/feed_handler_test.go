package handlers

import (
	"testing"
	"time"

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
