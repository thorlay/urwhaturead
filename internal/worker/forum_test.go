package worker

import (
	"testing"

	"github.com/mmcdole/gofeed"
)

func TestForumDescriptionBecomesPersistentDiscussionContent(t *testing.T) {
	article, ok := mapFeedItemToArticle(1, &gofeed.Item{GUID: "123", Link: "https://news.ycombinator.com/item?id=123", Description: "<p>Alice: useful.</p><p>Bob: too expensive.</p>"})
	if !ok || article.Content == nil {
		t.Fatal("RSS description must be kept as forum content")
	}
	updates := existingArticleDiscussionUpdates(article)
	if updates["content"] != *article.Content || updates["content_hash"] != article.ContentHash {
		t.Fatal("a repeated GUID must update comments even without a reply count")
	}
	article.Link = "https://example.com/blog"
	if len(existingArticleDiscussionUpdates(article)) != 0 {
		t.Fatal("ordinary article bodies must not be replaced on repeated fetches")
	}
}
