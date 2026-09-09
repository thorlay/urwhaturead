package models

import "time"

type AITask struct {
	ID         uint64    `json:"id" gorm:"primaryKey;column:id"`
	TaskKey    string    `json:"task_key" gorm:"column:task_key;not null;uniqueIndex:ux_ai_tasks_task_key"`
	Kind       string    `json:"kind" gorm:"column:kind;not null;index:ix_ai_tasks_kind_status"`
	ResourceID uint64    `json:"resource_id" gorm:"column:resource_id;not null;index"`
	Model      string    `json:"model" gorm:"column:model;not null;default:''"`
	Refresh    bool      `json:"refresh" gorm:"column:refresh;not null;default:false"`
	Payload    string    `json:"-" gorm:"column:payload;type:text;not null;default:'{}'"`
	Status     string    `json:"status" gorm:"column:status;not null;index:ix_ai_tasks_kind_status"`
	Error      string    `json:"error" gorm:"column:error;type:text;not null;default:''"`
	CreatedAt  time.Time `json:"created_at" gorm:"column:created_at;not null"`
	UpdatedAt  time.Time `json:"updated_at" gorm:"column:updated_at;not null;index"`
}

func (AITask) TableName() string {
	return "ai_tasks"
}
