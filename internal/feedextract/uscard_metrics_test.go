package feedextract

import (
	"encoding/json"
	"fmt"
	"github.com/mmcdole/gofeed"
	"testing"
)

func TestUSCardReplyTotalsUseRSSFooter(t *testing.T) {
	for _, tc := range []struct {
		posts, participants string
		want                int
	}{{"51 个帖子", "9 位参与者", 50}, {"1 个帖子", "1 位参与者", 0}, {"38 posts", "20 participants", 37}} {
		body := fmt.Sprintf(`<p>用户提到 2026、99 条评论</p><p><small>%s - %s</small></p><p><a href="https://www.uscardforum.com/t/topic/123">阅读完整话题</a></p>`, tc.posts, tc.participants)
		item := &gofeed.Item{Link: "https://www.uscardforum.com/t/topic/123", Description: body}
		got := ReplyCountFromFeedItem(item)
		if got == nil || *got != tc.want {
			t.Fatalf("%s: got %v", body, got)
		}
		raw, _ := json.Marshal(item)
		fromRaw := ForumReplyCountFromRaw(raw)
		if fromRaw == nil || *fromRaw != tc.want {
			t.Fatal("historical RSS reparsing must use the same total")
		}
	}
	for _, body := range []string{`用户说51 个帖子 - 9 位参与者`, `<p><small>51 个帖子 - 9 位参与者</small></p><p><a href="https://www.uscardforum.com/t/topic/999">阅读完整话题</a></p>`, `<p><small>51 个帖子 - 9 位参与者</small></p><p><a href="https://www.uscardforum.com/t/topic/123">阅读完整话题</a></p><p>仍在用户正文中</p>`} {
		if got := ForumReplyCount(&gofeed.Item{Link: "https://www.uscardforum.com/t/topic/123", Description: body}); got != nil {
			t.Fatalf("prose or mismatched footer must stay unknown: %v", got)
		}
	}
}
