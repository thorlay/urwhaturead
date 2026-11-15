package handlers

import (
	"context"
	"strings"
	"time"

	"quick/internal/models"

	"gorm.io/gorm"
)

type feedRepository struct {
	db *gorm.DB
}

type feedListParams struct {
	channel       string
	minReplies    int
	important     bool
	limit         int
	dedupe        bool
	includeHidden bool
	tag           string
	sourceIDs     []uint64
	keyword       string
	since         *time.Time
	cursor        *feedCursor
}

type feedListResult struct {
	rows                 []feedItem
	totalCount           int64
	queryElapsed         time.Duration
	dedupeCandidateLimit int
}

type feedRepositoryError struct {
	message string
	cause   error
}

func newFeedRepository(db *gorm.DB) *feedRepository {
	return &feedRepository{db: db}
}

func (r *feedRepository) list(ctx context.Context, params feedListParams) (feedListResult, *feedRepositoryError) {
	columns := `
			a.id,
			a.source_id,
			a.cluster_id,
			s.name AS source_name,
			COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
			a.title,
			a.link,
			a.summary,
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
			COALESCE(ec.article_count, 1) AS duplicate_count,
			a.created_at,
			COALESCE(a.published_at, a.created_at) AS sort_time
		`
	if params.channel == "forum" {
		columns = strings.Replace(columns, "a.link,", forumTopicLinkSelect, 1)
	}
	query := r.db.WithContext(ctx).
		Table("articles AS a").
		Select(columns).
		Joins("JOIN sources AS s ON s.id = a.source_id").
		Joins("LEFT JOIN event_clusters AS ec ON ec.id = a.cluster_id")
	query = filterFeedChannel(query, params.channel)
	if !params.includeHidden {
		query = query.Where("s.hidden_in_sidebar = ? AND s.kind <> ?", false, "thread")
	}
	if params.tag != "" && params.tag != "forum" {
		query = query.Where("s.tags @> ?::text[]", models.StringArray{params.tag})
	}
	if len(params.sourceIDs) > 0 {
		query = query.Where("a.source_id IN ?", params.sourceIDs)
	}
	if params.keyword != "" {
		like := "%" + params.keyword + "%"
		query = query.Where(
			"(a.title ILIKE ? OR a.summary ILIKE ? OR a.content ILIKE ?)",
			like, like, like,
		)
	}
	if params.since != nil {
		query = query.Where("a.created_at > ?", *params.since)
	}
	if params.channel == "forum" && !params.important {
		return r.listForumDiscussions(ctx, query, params)
	}
	if params.important {
		return r.listImportant(ctx, query, params)
	}

	result := feedListResult{}
	if params.since != nil {
		if err := query.Session(&gorm.Session{}).
			Select("COUNT(DISTINCT a.id)").
			Scan(&result.totalCount).Error; err != nil {
			return result, &feedRepositoryError{
				message: "count feed items since checkpoint failed",
				cause:   err,
			}
		}
	}
	if params.cursor != nil {
		query = query.Where(
			"(COALESCE(a.published_at, a.created_at), a.id) < (?, ?)",
			params.cursor.SortTime, params.cursor.ID,
		)
	}

	queryStartedAt := time.Now()
	if params.dedupe {
		result.dedupeCandidateLimit = feedDedupeCandidateLimit(params.limit)
		candidates := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(result.dedupeCandidateLimit)

		ranked := r.db.WithContext(ctx).Table("(?) AS candidates", candidates).
			Select(`
				candidates.id,
				candidates.source_id,
				candidates.cluster_id,
				candidates.source_name,
				candidates.source_tag,
				candidates.title,
				candidates.link,
				candidates.summary,
				candidates.author,
				candidates.published_at,
				candidates.image_url,
				candidates.reply_count,
				candidates.created_at,
				candidates.sort_time,
				MAX(candidates.duplicate_count) OVER (PARTITION BY COALESCE(candidates.cluster_id, candidates.id)) AS duplicate_count,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(candidates.cluster_id, candidates.id)
					ORDER BY candidates.sort_time DESC, candidates.id DESC
				) AS rn
			`)

		outer := r.db.WithContext(ctx).Table("(?) AS ranked", ranked).
			Select(`
				ranked.id,
				ranked.source_id,
				ranked.cluster_id,
				ranked.source_name,
				ranked.source_tag,
				ranked.title,
				ranked.link,
				ranked.summary,
				ranked.author,
				ranked.published_at,
				ranked.image_url,
				ranked.reply_count,
				ranked.duplicate_count,
				ranked.created_at,
				ranked.sort_time
			`).
			Where("ranked.rn = 1")

		if err := outer.
			Order("ranked.sort_time DESC").
			Order("ranked.id DESC").
			Limit(params.limit + 1).
			Scan(&result.rows).Error; err != nil {
			return result, &feedRepositoryError{message: "query deduped feed failed", cause: err}
		}
	} else {
		if err := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(params.limit + 1).
			Scan(&result.rows).Error; err != nil {
			return result, &feedRepositoryError{message: "query feed failed", cause: err}
		}
	}
	result.queryElapsed = time.Since(queryStartedAt)
	return result, nil
}

func (r *feedRepository) listForumDiscussions(ctx context.Context, query *gorm.DB, params feedListParams) (feedListResult, *feedRepositoryError) {
	started := time.Now()
	query = query.Where("COALESCE(a.published_at,a.created_at) BETWEEN ? AND ? AND a.reply_count >= ?", forumRankingWindow(), time.Now().UTC(), params.minReplies)
	// Collapse the same topic subscribed through multiple feeds before pagination.
	ranked := r.db.WithContext(ctx).Table("(?) AS candidates", query).Select(`candidates.*, ROW_NUMBER() OVER (PARTITION BY regexp_replace(candidates.link, '^https?://(www\.)?', '') ORDER BY candidates.reply_count DESC,candidates.sort_time DESC,candidates.id DESC) AS forum_rank`)
	query = r.db.WithContext(ctx).Table("(?) AS ranked", ranked).Where("forum_rank=1")
	result := feedListResult{}
	if params.since != nil {
		if err := query.Session(&gorm.Session{}).Select("COUNT(*)").Scan(&result.totalCount).Error; err != nil {
			return result, &feedRepositoryError{"count forum discussions failed", err}
		}
	}
	if params.cursor != nil {
		if params.cursor.Replies == nil {
			return result, &feedRepositoryError{"invalid forum discussion cursor", nil}
		}
		query = query.Where("(reply_count,sort_time,id) < (?,?,?)", *params.cursor.Replies, params.cursor.SortTime, params.cursor.ID)
	}
	err := query.Order("reply_count DESC").Order("sort_time DESC").Order("id DESC").Limit(params.limit + 1).Scan(&result.rows).Error
	result.queryElapsed = time.Since(started)
	if err != nil {
		return result, &feedRepositoryError{"query forum discussions failed", err}
	}
	return result, nil
}

func (r *feedRepository) listImportant(ctx context.Context, query *gorm.DB, params feedListParams) (feedListResult, *feedRepositoryError) {
	started := time.Now()
	query = query.Joins("JOIN article_highlights h ON h.article_id = a.id").
		Where("h.generated_at >= ? AND s.enabled = ?", time.Now().Add(-72*time.Hour), true).
		Select(`a.id,a.source_id,a.cluster_id,s.name AS source_name,
		COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
		a.title,a.link,a.summary,a.author,a.published_at,a.image_url,a.reply_count,
		a.created_at,COALESCE(a.published_at,a.created_at) AS sort_time,
		h.reason AS highlight_reason,h.generated_at AS recommendation_time,
		ROW_NUMBER() OVER (PARTITION BY a.source_id ORDER BY h.generated_at DESC,a.id DESC) AS source_rank`)
	limit := params.limit
	if limit > 15 {
		limit = 15
	}
	result := feedListResult{}
	err := r.db.WithContext(ctx).Table("(?) AS selected", query).Select("selected.*").Where("source_rank <= 3").Order("recommendation_time DESC,id DESC").Limit(limit).Scan(&result.rows).Error
	result.queryElapsed = time.Since(started)
	if err != nil {
		return result, &feedRepositoryError{message: "query important feed failed", cause: err}
	}
	result.totalCount = int64(len(result.rows))
	return result, nil
}
