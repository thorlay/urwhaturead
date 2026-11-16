package handlers

import (
	"context"
	"gorm.io/gorm"
	"time"
)

const paperSourcePredicate = `COALESCE(s.tags @> ARRAY['papers']::text[] OR s.rss_url LIKE '%/huggingface/daily-papers%',false)`
const paperVotesSQL = `CASE WHEN a.raw #>> '{extensions,quick,paperVotes,0,value}' ~ '^[0-9]{1,8}$' THEN (a.raw #>> '{extensions,quick,paperVotes,0,value}')::int ELSE NULL END`
const paperActivePredicate = `COALESCE(NULLIF(a.raw #>> '{extensions,quick,paperSeenAt,0,value}','')::timestamptz,a.created_at) >= ?`

func (r *feedRepository) listPapers(ctx context.Context, query *gorm.DB, params feedListParams) (feedListResult, *feedRepositoryError) {
	started := time.Now()
	query = query.Where("s.enabled = true").Where(paperActivePredicate, time.Now().Add(-8*24*time.Hour))
	// The two boards often feature the same arXiv paper; dedupe before LIMIT/cursor.
	ranked := r.db.WithContext(ctx).Table("(?) AS candidates", query).Select(`candidates.*,ROW_NUMBER() OVER (PARTITION BY regexp_replace(candidates.link,'v[0-9]+$','') ORDER BY COALESCE(candidates.paper_votes,0) DESC,candidates.sort_time DESC,candidates.id DESC) AS paper_rank`)
	query = r.db.WithContext(ctx).Table("(?) AS ranked", ranked).Where("paper_rank=1")
	result := feedListResult{}
	if params.since != nil {
		if err := query.Session(&gorm.Session{}).Select("COUNT(*)").Scan(&result.totalCount).Error; err != nil {
			return result, &feedRepositoryError{"count paper feed failed", err}
		}
	}
	if params.cursor != nil {
		query = query.Where("(COALESCE(paper_votes,0),sort_time,id)<(?,?,?)", *params.cursor.Replies, params.cursor.SortTime, params.cursor.ID)
	}
	err := query.Order("COALESCE(paper_votes,0) DESC,sort_time DESC,id DESC").Limit(params.limit + 1).Scan(&result.rows).Error
	result.queryElapsed = time.Since(started)
	if err != nil {
		return result, &feedRepositoryError{"query paper feed failed", err}
	}
	return result, nil
}
