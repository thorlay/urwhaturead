package feedextract

import "testing"

func TestIsForumThread(t *testing.T) {
	for _, link := range []string{"https://v2ex.com/t/123", "https://www.v2ex.com/t/456", "https://news.ycombinator.com/item?id=123", "https://bbs.nga.cn/read.php?tid=123", "https://nga.178.com/read.php?tid=123#postcontent456"} {
		if !IsForumThread(link) {
			t.Fatalf("missing discussion link %s", link)
		}
	}
	for _, link := range []string{"https://v2ex.com.evil.com/t/123", "https://news.ycombinator.com/", "https://example.com/item?id=123", "https://bbs.nga.cn.evil.com/read.php?tid=123", "https://bbs.nga.cn/read.php?tid=bad"} {
		if IsForumThread(link) {
			t.Fatalf("not a supported discussion link %s", link)
		}
	}
}
