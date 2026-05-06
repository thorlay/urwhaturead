package models

import "time"

type Source struct {
	ID                  uint64      `json:"id" gorm:"primaryKey;column:id"`
	OwnerUserID         *uint64     `json:"owner_user_id" gorm:"column:owner_user_id"`
	Name                string      `json:"name" gorm:"column:name;not null"`
	RSSURL              string      `json:"rss_url" gorm:"column:rss_url;not null"`
	SiteKey             string      `json:"site_key" gorm:"column:site_key;not null;default:'';index"`
	Kind                string      `json:"kind" gorm:"column:kind;not null;default:feed;index"`
	TopicURL            *string     `json:"topic_url,omitempty" gorm:"column:topic_url"`
	HiddenInSidebar     bool        `json:"hidden_in_sidebar" gorm:"column:hidden_in_sidebar;not null;default:false;index"`
	Tags                StringArray `json:"tags,omitempty" gorm:"column:tags;type:text[]"`
	NewArticles24h      int64       `json:"new_articles_24h" gorm:"column:new_articles_24h;->;-:migration"`
	ClickCount          int64       `json:"click_count" gorm:"column:click_count;not null;default:0"`
	LastClickedAt       *time.Time  `json:"last_clicked_at,omitempty" gorm:"column:last_clicked_at"`
	Enabled             bool        `json:"enabled" gorm:"column:enabled;not null;default:true"`
	PollIntervalSec     int         `json:"poll_interval_sec" gorm:"column:poll_interval_sec;not null;default:900"`
	ETag                *string     `json:"etag,omitempty" gorm:"column:etag"`
	LastModified        *string     `json:"last_modified,omitempty" gorm:"column:last_modified"`
	LastFetchedAt       *time.Time  `json:"last_fetched_at,omitempty" gorm:"column:last_fetched_at"`
	ConsecutiveFailures int         `json:"consecutive_failures" gorm:"column:consecutive_failures;not null;default:0"`
	LastErrorAt         *time.Time  `json:"last_error_at,omitempty" gorm:"column:last_error_at"`
	LastErrorMessage    *string     `json:"last_error_message,omitempty" gorm:"column:last_error_message"`
	CreatedAt           time.Time   `json:"created_at" gorm:"column:created_at;not null"`
	UpdatedAt           time.Time   `json:"updated_at" gorm:"column:updated_at;not null"`
}

func (Source) TableName() string {
	return "sources"
}
