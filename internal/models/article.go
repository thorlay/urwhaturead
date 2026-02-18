package models

import (
	"time"

	"gorm.io/datatypes"
)

type Article struct {
	ID          uint64         `json:"id" gorm:"primaryKey;column:id"`
	SourceID    uint64         `json:"source_id" gorm:"column:source_id;not null"`
	RawGUID     *string        `json:"raw_guid,omitempty" gorm:"column:raw_guid"`
	Link        string         `json:"link" gorm:"column:link;not null"`
	Title       string         `json:"title" gorm:"column:title;not null"`
	Summary     *string        `json:"summary,omitempty" gorm:"column:summary"`
	Content     *string        `json:"content,omitempty" gorm:"column:content"`
	Author      *string        `json:"author,omitempty" gorm:"column:author"`
	PublishedAt *time.Time     `json:"published_at,omitempty" gorm:"column:published_at"`
	ImageURL    *string        `json:"image_url,omitempty" gorm:"column:image_url"`
	Tags        StringArray    `json:"tags,omitempty" gorm:"column:tags;type:text[]"`
	ContentHash string         `json:"content_hash" gorm:"column:content_hash;not null"`
	Raw         datatypes.JSON `json:"raw,omitempty" gorm:"column:raw;type:jsonb"`
	CreatedAt   time.Time      `json:"created_at" gorm:"column:created_at;not null"`
}

func (Article) TableName() string {
	return "articles"
}
