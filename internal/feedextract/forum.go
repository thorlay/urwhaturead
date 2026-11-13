package feedextract

import (
	"net/url"
	"strconv"
	"strings"
)

// Discussion links identify the thread, rather than an article linked by it.
func IsForumThread(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "uscardforum.com", "www.uscardforum.com":
		_, ok := USCardTopicURL(rawURL)
		return ok
	case "v2ex.com", "www.v2ex.com":
		return strings.HasPrefix(u.Path, "/t/")
	case "news.ycombinator.com":
		return u.Path == "/item" && u.Query().Get("id") != ""
	case "nga.178.com", "bbs.nga.cn", "ngabbs.com", "bbs.ngacn.cc":
		_, ok := NGAThreadID(rawURL)
		return ok
	}
	return false
}

func NGAThreadID(rawURL string) (string, bool) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Path != "/read.php" {
		return "", false
	}
	switch strings.ToLower(u.Hostname()) {
	case "nga.178.com", "bbs.nga.cn", "ngabbs.com", "bbs.ngacn.cc":
	default:
		return "", false
	}
	id := u.Query().Get("tid")
	value, err := strconv.ParseUint(id, 10, 64)
	return id, err == nil && value > 0
}

// Canonical topic URLs accept the main post or an individual reply, never another host.
func USCardTopicURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || (u.Hostname() != "www.uscardforum.com" && u.Hostname() != "uscardforum.com") {
		return "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 3 || len(parts) > 4 || parts[0] != "t" || parts[1] != "topic" {
		return "", false
	}
	for _, part := range parts[2:] {
		if id, err := strconv.ParseUint(part, 10, 64); err != nil || id == 0 {
			return "", false
		}
	}
	return "https://www.uscardforum.com/t/topic/" + parts[2], true
}
