package models

import (
	"time"

	"gorm.io/datatypes"
)

type ArticleEnrichment struct {
	ArticleID uint64         `gorm:"column:article_id;primaryKey"`
	Thread    datatypes.JSON `gorm:"column:thread;type:jsonb"`
	External  datatypes.JSON `gorm:"column:external;type:jsonb"`
	FetchedAt time.Time      `gorm:"column:fetched_at;not null"`
	UpdatedAt time.Time      `gorm:"column:updated_at;not null"`
}

func (ArticleEnrichment) TableName() string {
	return "article_enrichments"
}
