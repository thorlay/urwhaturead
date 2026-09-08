package models

import (
	"time"

	"gorm.io/datatypes"
)

type Article struct {
	ID              uint64         `json:"id" gorm:"primaryKey;column:id"`
	SourceID        uint64         `json:"source_id" gorm:"column:source_id;not null;uniqueIndex:ux_articles_source_content_hash"`
	ClusterID       *uint64        `json:"cluster_id,omitempty" gorm:"column:cluster_id;index"`
	RawGUID         *string        `json:"raw_guid,omitempty" gorm:"column:raw_guid"`
	Link            string         `json:"link" gorm:"column:link;not null"`
	CanonicalLink   string         `json:"canonical_link" gorm:"column:canonical_link;not null;default:'';index"`
	Title           string         `json:"title" gorm:"column:title;not null"`
	NormalizedTitle string         `json:"normalized_title" gorm:"column:normalized_title;not null;default:'';index"`
	Summary         *string        `json:"summary,omitempty" gorm:"column:summary"`
	Content         *string        `json:"content,omitempty" gorm:"column:content"`
	Author          *string        `json:"author,omitempty" gorm:"column:author"`
	PublishedAt     *time.Time     `json:"published_at,omitempty" gorm:"column:published_at"`
	ImageURL        *string        `json:"image_url,omitempty" gorm:"column:image_url"`
	ReplyCount      *int           `json:"reply_count,omitempty" gorm:"column:reply_count"`
	Tags            StringArray    `json:"tags,omitempty" gorm:"column:tags;type:text[]"`
	ContentHash     string         `json:"content_hash" gorm:"column:content_hash;not null;uniqueIndex:ux_articles_source_content_hash"`
	Raw             datatypes.JSON `json:"raw,omitempty" gorm:"column:raw;type:jsonb"`
	CreatedAt       time.Time      `json:"created_at" gorm:"column:created_at;not null"`
}

func (Article) TableName() string {
	return "articles"
}
