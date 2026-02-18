package models

import "time"

type ArticleSummary struct {
	ID          uint64    `json:"id" gorm:"primaryKey;column:id"`
	ArticleID   uint64    `json:"article_id" gorm:"column:article_id;not null;uniqueIndex:ux_article_summaries_article_id"`
	Summary     string    `json:"summary" gorm:"column:summary;type:text;not null"`
	Model       string    `json:"model" gorm:"column:model;not null"`
	Provider    string    `json:"provider" gorm:"column:provider;not null"`
	InputChars  int       `json:"input_chars" gorm:"column:input_chars;not null"`
	Truncated   bool      `json:"truncated" gorm:"column:truncated;not null;default:false"`
	GeneratedAt time.Time `json:"generated_at" gorm:"column:generated_at;not null"`
	CreatedAt   time.Time `json:"created_at" gorm:"column:created_at;not null"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"column:updated_at;not null"`
}

func (ArticleSummary) TableName() string {
	return "article_summaries"
}
