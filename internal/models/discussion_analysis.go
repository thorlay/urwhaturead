package models

import (
	"gorm.io/datatypes"
	"time"
)

// Kept separate from the ordinary article summary so the two actions never overwrite each other.
type DiscussionAnalysis struct {
	ArticleID    uint64         `gorm:"primaryKey;column:article_id"`
	BaseRevision string         `gorm:"column:base_revision;not null"`
	InputHash    string         `gorm:"column:input_hash;primaryKey"`
	Model        string         `gorm:"column:model;not null"`
	Payload      datatypes.JSON `gorm:"column:payload;type:jsonb;not null"`
	GeneratedAt  time.Time      `gorm:"column:generated_at;not null"`
}

func (DiscussionAnalysis) TableName() string { return "discussion_analyses" }
