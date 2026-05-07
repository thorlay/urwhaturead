package models

import "time"

type FeedBriefing struct {
	ID          uint64    `json:"id" gorm:"primaryKey;column:id"`
	DigestKey   string    `json:"digest_key" gorm:"column:digest_key;not null;uniqueIndex:ux_feed_briefings_digest_key"`
	Tag         string    `json:"tag" gorm:"column:tag;not null;default:''"`
	Keyword     string    `json:"keyword" gorm:"column:keyword;not null;default:''"`
	SourceIDs   string    `json:"source_ids" gorm:"column:source_ids;not null;default:''"`
	ArticleIDs  string    `json:"article_ids" gorm:"column:article_ids;not null;default:''"`
	Limit       int       `json:"limit" gorm:"column:limit;not null;default:20"`
	Summary     string    `json:"summary" gorm:"column:summary;type:text;not null"`
	Model       string    `json:"model" gorm:"column:model;not null"`
	Provider    string    `json:"provider" gorm:"column:provider;not null"`
	InputChars  int       `json:"input_chars" gorm:"column:input_chars;not null"`
	Truncated   bool      `json:"truncated" gorm:"column:truncated;not null;default:false"`
	StopReason  string    `json:"stop_reason" gorm:"column:stop_reason;not null;default:''"`
	GeneratedAt time.Time `json:"generated_at" gorm:"column:generated_at;not null"`
	CreatedAt   time.Time `json:"created_at" gorm:"column:created_at;not null"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"column:updated_at;not null"`
}

func (FeedBriefing) TableName() string {
	return "feed_briefings"
}
