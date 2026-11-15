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

func TestUSCardRSSRetainsThreadBodyAndReplyCount(t *testing.T) {
	item := &gofeed.Item{GUID: "www.uscardforum.com-topic-123", Link: "https://www.uscardforum.com/t/topic/123", Description: `<p>原帖问题</p><p><small>31 个帖子 - 9 位参与者</small></p><p><a href="https://www.uscardforum.com/t/topic/123">阅读完整话题</a></p>`}
	article, ok := mapFeedItemToArticle(1, item)
	if !ok || article.Content == nil || article.ReplyCount == nil || *article.ReplyCount != 30 {
		t.Fatalf("missing source body or reliable count: %+v", article)
	}
	if existingArticleDiscussionUpdates(article)["content"] == nil {
		t.Fatal("repeated topics must refresh their discussion material")
	}
}
