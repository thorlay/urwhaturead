package handlers

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

const forumTopicLinkSelect = "CASE WHEN a.raw->>'guid' LIKE ('https://news.ycombinator.com/item' || chr(63) || '%') THEN a.raw->>'guid' ELSE a.link END AS link,"

// Source-level classification also catches older subscriptions tagged only tech.
const forumSourcePredicate = `COALESCE(s.tags @> ARRAY['forum']::text[] OR s.site_key IN ('v2ex','v2ex.com','hackernews','hnrss.org','news.ycombinator.com','reddit','reddit.com','nga','bbs.nga.cn','uscardforum.com','linux.do','1point3acres','1point3acres.com','tieba') OR s.rss_url ~* '(^rsshub://|/)(v2ex|hackernews|reddit|nga|uscardforum|1point3acres|tieba|linuxdo)/', false)`

func filterFeedChannel(query *gorm.DB, channel string) *gorm.DB {
	switch channel {
	case "news":
		return query.Where("NOT (" + forumSourcePredicate + ") AND NOT (" + paperSourcePredicate + ")")
	case "papers":
		return query.Where(paperSourcePredicate)
	case "forum":
		return query.Where(forumSourcePredicate)
	default:
		return query
	}
}

// The original forums use thread creation time and total replies. For sources
// with timed reply samples, count only replies still inside the rolling window.
func forumCandidates(db, query *gorm.DB, columns string, minimum int, explicitMinimum bool) *gorm.DB {
	now := time.Now().UTC()
	since := now.Add(-24 * time.Hour)
	columns = strings.Replace(columns, "COALESCE(a.published_at, a.created_at) AS sort_time", "COALESCE(a.forum_activity_at, a.published_at, a.created_at) AS sort_time", 1)
	columns += `, a.forum_activity_at, s.site_key,
		CASE WHEN a.forum_activity_at IS NOT NULL THEN (
			SELECT COUNT(*) FROM jsonb_array_elements(a.raw #> '{public_discussion,replies}') AS reply
			WHERE (reply->>'at')::timestamptz BETWEEN ? AND ?
		) END AS recent_reply_count`
	query = query.Select(columns, since, now).
		Where("COALESCE(a.forum_activity_at,a.published_at,a.created_at) BETWEEN ? AND ?", since, now)
	candidates := db.Table("(?) AS candidates", query)
	if explicitMinimum {
		return candidates.Where("COALESCE(recent_reply_count,reply_count) >= ?", minimum)
	}
	return candidates.Where(`(recent_reply_count IS NULL AND reply_count >= ?)
		OR recent_reply_count >= (CASE WHEN site_key = 'bogleheads.org' THEN 3 ELSE 5 END)`, minimum)
}
