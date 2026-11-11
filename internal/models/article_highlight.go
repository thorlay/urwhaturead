package models

import "time"

// ArticleHighlight materializes an explicit reading recommendation from a briefing.
type ArticleHighlight struct {
	ArticleID   uint64    `gorm:"primaryKey"`
	Reason      string    `gorm:"type:text;not null"`
	GeneratedAt time.Time `gorm:"not null;index"`
}
