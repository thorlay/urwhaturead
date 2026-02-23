package models

import "time"

type EventCluster struct {
	ID                      uint64     `json:"id" gorm:"primaryKey;column:id"`
	CanonicalLink           string     `json:"canonical_link" gorm:"column:canonical_link;not null;default:'';index"`
	NormalizedTitle         string     `json:"normalized_title" gorm:"column:normalized_title;not null;default:'';index"`
	RepresentativeArticleID uint64     `json:"representative_article_id" gorm:"column:representative_article_id;not null"`
	ArticleCount            int        `json:"article_count" gorm:"column:article_count;not null;default:1"`
	FirstPublishedAt        *time.Time `json:"first_published_at,omitempty" gorm:"column:first_published_at"`
	LastPublishedAt         *time.Time `json:"last_published_at,omitempty" gorm:"column:last_published_at;index"`
	CreatedAt               time.Time  `json:"created_at" gorm:"column:created_at;not null"`
	UpdatedAt               time.Time  `json:"updated_at" gorm:"column:updated_at;not null"`
}

func (EventCluster) TableName() string {
	return "event_clusters"
}
