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
