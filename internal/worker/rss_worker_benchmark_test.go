package worker

import (
	"strings"
	"testing"

	"github.com/mmcdole/gofeed"

	"quick/internal/feedextract"
)

func BenchmarkMapFeedItemToArticle(b *testing.B) {
	for _, description := range []string{"<p>文章摘要</p>", ""} {
		name := "with_summary"
		if description == "" {
			name = "fallback_summary"
		}
		b.Run(name, func(b *testing.B) {
			item := &gofeed.Item{
				Title: "文章标题", Link: "https://example.com/article",
				Description: description,
				Content:     strings.Repeat("<p>正文内容包含中文、English 和数字 2026。</p>", 300),
				Image:       &gofeed.Image{URL: "https://example.com/cover.jpg"},
			}
			feedextract.SetForumReplyCount(item, 0)
			b.ReportAllocs()
			for b.Loop() {
				mapFeedItemToArticle(1, item)
			}
		})
	}
}
