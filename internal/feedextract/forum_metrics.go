package feedextract

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
)

var discoursePostCount = regexp.MustCompile(`(?is)<p>\s*<small>\s*(\d+)\s*(?:个帖子|posts?)\s*[-–]\s*\d+\s*(?:位参与者|participants?)\s*</small>\s*</p>\s*<p>\s*<a\s[^>]*href=["']https?://(?:www\.)?uscardforum\.com/t/topic/(\d+)/?["'][^>]*>[^<]*</a>\s*</p>\s*$`)

var hnCommentCount = regexp.MustCompile(`(?i)<p>\s*#\s*Comments:\s*(\d+)\s*</p>`)

// Forum body text is user content, not metadata. Never infer totals from prose.
func ForumReplyCount(item *gofeed.Item) *int {
	if item == nil {
		return nil
	}
	for ns, values := range item.Extensions {
		for name, entries := range values {
			if !shouldInspectReplyCountKey(ns, name) {
				continue
			}
			for _, entry := range entries {
				if n, err := strconv.Atoi(strings.TrimSpace(entry.Value)); err == nil && n >= 0 {
					return intPtr(n)
				}
			}
		}
	}
	if strings.Contains(item.GUID, "news.ycombinator.com/item?") {
		if match := hnCommentCount.FindStringSubmatch(item.Description); len(match) > 1 {
			n, _ := strconv.Atoi(match[1])
			return intPtr(n)
		}
	}
	if topic, ok := USCardTopicURL(item.Link); ok {
		if match := discoursePostCount.FindStringSubmatch(item.Description); len(match) > 2 && strings.HasSuffix(topic, "/"+match[2]) {
			posts, err := strconv.Atoi(match[1])
			if err == nil && posts >= 1 {
				return intPtr(posts - 1)
			}
		}
	}
	return nil
}

func ForumReplyCountFromRaw(raw []byte) *int {
	var item gofeed.Item
	if json.Unmarshal(raw, &item) != nil {
		return nil
	}
	return ForumReplyCount(&item)
}

func SetForumReplyCount(item *gofeed.Item, count int) {
	if item.Extensions == nil {
		item.Extensions = ext.Extensions{}
	}
	if item.Extensions["slash"] == nil {
		item.Extensions["slash"] = map[string][]ext.Extension{}
	}
	item.Extensions["slash"]["comments"] = []ext.Extension{{Name: "comments", Value: strconv.Itoa(count)}}
}
