package models

import "time"

type SourceFetchLog struct {
	ID           uint64    `json:"id" gorm:"primaryKey;column:id"`
	SourceID     uint64    `json:"source_id" gorm:"column:source_id;not null"`
	FetchedAt    time.Time `json:"fetched_at" gorm:"column:fetched_at;not null"`
	Status       string    `json:"status" gorm:"column:status;not null"`
	HTTPStatus   *int      `json:"http_status,omitempty" gorm:"column:http_status"`
	ItemCount    int       `json:"item_count" gorm:"column:item_count;not null;default:0"`
	DurationMS   *int      `json:"duration_ms,omitempty" gorm:"column:duration_ms"`
	ErrorMessage *string   `json:"error_message,omitempty" gorm:"column:error_message"`
}

func (SourceFetchLog) TableName() string {
	return "source_fetch_logs"
}
