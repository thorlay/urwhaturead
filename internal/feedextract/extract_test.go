package feedextract

import (
	"testing"

	"github.com/mmcdole/gofeed"
)

func TestImageFromFeedItem_FromHTML(t *testing.T) {
	item := &gofeed.Item{
		Link:    "https://example.com/posts/42",
		Content: `<p>hello</p><img data-src="/assets/cover.jpg">`,
	}
	got := ImageFromFeedItem(item)
	want := "https://example.com/assets/cover.jpg"
	if got != want {
		t.Fatalf("ImageFromFeedItem()=%q, want %q", got, want)
	}
}

func TestImageFromRaw_FromExtensions(t *testing.T) {
	raw := []byte(`{
		"link":"https://example.com/story",
		"extensions":{
			"media":{
				"content":[
					{"attrs":{"url":"https://cdn.example.com/hero.png","medium":"image"}}
				]
			}
		}
	}`)
	got := ImageFromRaw(raw, "https://example.com/story")
	want := "https://cdn.example.com/hero.png"
	if got != want {
		t.Fatalf("ImageFromRaw()=%q, want %q", got, want)
	}
}

func TestContentHTMLFromRaw(t *testing.T) {
	raw := []byte(`{"content":"<div><p>正文</p><img src=\"https://img.example.com/1.jpg\"></div>"}`)
	got := ContentHTMLFromRaw(raw)
	if got == "" {
		t.Fatalf("ContentHTMLFromRaw should not be empty")
	}
	if got[:5] != "<div>" {
		t.Fatalf("unexpected html prefix: %q", got)
	}
}
