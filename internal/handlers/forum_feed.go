package handlers

import (
	"time"

	"gorm.io/gorm"
)

const forumTopicLinkSelect = "CASE WHEN a.raw->>'guid' LIKE 'https://news.ycombinator.com/item?%' THEN a.raw->>'guid' ELSE a.link END AS link,"

// Source-level classification also catches older subscriptions tagged only tech.
const forumSourcePredicate = `COALESCE(s.tags @> ARRAY['forum']::text[] OR s.site_key IN ('v2ex','v2ex.com','hackernews','hnrss.org','news.ycombinator.com','reddit','reddit.com','nga','bbs.nga.cn','uscardforum.com','linux.do','1point3acres','1point3acres.com','tieba') OR s.rss_url ~* '(^rsshub://|/)(v2ex|hackernews|reddit|nga|uscardforum|1point3acres|tieba|linuxdo)/', false)`

func filterFeedChannel(query *gorm.DB, channel string) *gorm.DB {
	switch channel {
	case "news":
		return query.Where("NOT (" + forumSourcePredicate + ")")
	case "forum":
		return query.Where(forumSourcePredicate)
	default:
		return query
	}
}

func forumRankingWindow() time.Time { return time.Now().UTC().Add(-72 * time.Hour) }
