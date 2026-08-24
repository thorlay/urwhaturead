package models

import "time"

// FeedBriefingArticle records the article state included in an AI briefing.
// It lets later scheduled runs exclude already-covered articles and events.
type FeedBriefingArticle struct {
	ID              uint64    `json:"id" gorm:"primaryKey;column:id"`
	FeedBriefingID  uint64    `json:"feed_briefing_id" gorm:"column:feed_briefing_id;not null;uniqueIndex:ux_feed_briefing_articles_briefing_article;index"`
	SourceID        uint64    `json:"source_id" gorm:"column:source_id;not null;index"`
	ArticleID       uint64    `json:"article_id" gorm:"column:article_id;not null;uniqueIndex:ux_feed_briefing_articles_briefing_article;index"`
	ClusterID       *uint64   `json:"cluster_id,omitempty" gorm:"column:cluster_id;index"`
	ContentHash     string    `json:"content_hash" gorm:"column:content_hash;not null;default:''"`
	ReplyCount      *int      `json:"reply_count,omitempty" gorm:"column:reply_count"`
	BriefingCreated time.Time `json:"briefing_created" gorm:"column:briefing_created;not null;index"`
	CreatedAt       time.Time `json:"created_at" gorm:"column:created_at;not null"`
}

func (FeedBriefingArticle) TableName() string {
	return "feed_briefing_articles"
}
