package feedextract

import (
	"testing"

	"github.com/mmcdole/gofeed"
)

func TestReplyCountFromFeedItem_FromExtensions(t *testing.T) {
	parser := gofeed.NewParser()
	feed, err := parser.ParseString(`<?xml version="1.0"?>
<rss version="2.0" xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
  <channel>
    <title>Example</title>
    <item>
      <title>Forum Topic</title>
      <link>https://example.com/t/1</link>
      <slash:comments>42</slash:comments>
    </item>
  </channel>
</rss>`)
	if err != nil {
		t.Fatalf("parse rss failed: %v", err)
	}
	if feed == nil || len(feed.Items) == 0 {
		t.Fatalf("feed has no items")
	}

	value := ReplyCountFromFeedItem(feed.Items[0])
	if value == nil || *value != 42 {
		t.Fatalf("ReplyCountFromFeedItem()=%v, want 42", value)
	}
}

func TestReplyCountFromFeedItem_FromDescription(t *testing.T) {
	item := &gofeed.Item{
		Title:       "Topic",
		Description: "This post has 18 replies and keeps growing.",
		Link:        "https://example.com/t/2",
	}
	value := ReplyCountFromFeedItem(item)
	if value == nil || *value != 18 {
		t.Fatalf("ReplyCountFromFeedItem()=%v, want 18", value)
	}
}

func TestReplyCountFromRaw(t *testing.T) {
	raw := []byte(`{"description":"评论: 27","content":"<p>details</p>"}`)
	value := ReplyCountFromRaw(raw)
	if value == nil || *value != 27 {
		t.Fatalf("ReplyCountFromRaw()=%v, want 27", value)
	}
}

func TestForumCountsRejectProseAndURLs(t *testing.T) {
	for _, body := range []string{"Comments URL: https://news.ycombinator.com/item?id=50468888", "2026-11-13 someone says other comments were wrong", "我读了 99 条评论"} {
		item := &gofeed.Item{Link: "https://nga.178.com/read.php?tid=123", Description: body}
		if ReplyCountFromFeedItem(item) != nil {
			t.Fatalf("untrusted body became metadata: %s", body)
		}
	}
	item := &gofeed.Item{GUID: "https://news.ycombinator.com/item?id=123", Link: "https://example.com", Description: `<p>Comments URL: https://news.ycombinator.com/item?id=123</p><p>Points: 500</p><p># Comments: 119</p>`}
	got := ReplyCountFromFeedItem(item)
	if got == nil || *got != 119 {
		t.Fatalf("HN explicit count: %v", got)
	}
}
