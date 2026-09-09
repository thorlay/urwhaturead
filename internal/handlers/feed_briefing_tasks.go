package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"quick/internal/articlesummary"
	"quick/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	feedBriefingTaskKind      = "feed_briefing"
	feedBriefingTaskTimeout   = 5 * time.Minute
	feedBriefingRecoveryAge   = 7 * 24 * time.Hour
	feedBriefingRecoveryMax   = 100
	feedBriefingConcurrency   = 2
	feedBriefingTaskKeyPrefix = "feed_briefing|"
)

type feedBriefingTaskInput struct {
	DigestKey  string   `json:"digest_key"`
	Limit      int      `json:"limit"`
	Tag        string   `json:"tag,omitempty"`
	Keyword    string   `json:"keyword,omitempty"`
	Model      string   `json:"model"`
	SourceIDs  []uint64 `json:"source_ids,omitempty"`
	ArticleIDs []uint64 `json:"article_ids"`
	Refresh    bool     `json:"refresh"`
}

type feedBriefingTaskState struct {
	DigestKey string    `json:"digest_key"`
	Model     string    `json:"model"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type feedBriefingTaskRunner func(context.Context, feedBriefingTaskInput) error

type feedBriefingTaskService struct {
	db     *gorm.DB
	runner feedBriefingTaskRunner
	sem    chan struct{}

	mu       sync.Mutex
	inFlight map[string]struct{}
}

func newFeedBriefingTaskService(db *gorm.DB, runner feedBriefingTaskRunner) *feedBriefingTaskService {
	service := &feedBriefingTaskService{
		db:       db,
		runner:   runner,
		sem:      make(chan struct{}, feedBriefingConcurrency),
		inFlight: make(map[string]struct{}),
	}
	if db != nil && runner != nil {
		go service.resumePending()
	}
	return service
}

func (s *feedBriefingTaskService) Enqueue(input feedBriefingTaskInput) (feedBriefingTaskState, error) {
	if s == nil || s.db == nil || s.runner == nil {
		return feedBriefingTaskState{}, errors.New("feed briefing task service is not configured")
	}
	input.DigestKey = strings.TrimSpace(input.DigestKey)
	if input.DigestKey == "" {
		return feedBriefingTaskState{}, errors.New("feed briefing digest key is empty")
	}

	key := feedBriefingTaskKey(input.DigestKey)
	s.mu.Lock()
	if _, running := s.inFlight[key]; running {
		s.mu.Unlock()
		return s.GetState(context.Background(), input.DigestKey)
	}
	s.inFlight[key] = struct{}{}
	s.mu.Unlock()

	now := time.Now().UTC()
	state := feedBriefingTaskState{
		DigestKey: input.DigestKey,
		Model:     strings.TrimSpace(input.Model),
		Status:    articlesummary.StatusQueued,
		UpdatedAt: now,
	}
	payload, err := json.Marshal(input)
	if err != nil {
		s.release(key)
		return feedBriefingTaskState{}, err
	}
	task := models.AITask{
		TaskKey:   key,
		Kind:      feedBriefingTaskKind,
		Model:     state.Model,
		Refresh:   input.Refresh,
		Payload:   string(payload),
		Status:    state.Status,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "task_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"kind", "model", "refresh", "payload", "status", "error", "updated_at",
		}),
	}).Create(&task).Error; err != nil {
		s.release(key)
		return feedBriefingTaskState{}, err
	}

	go s.run(key, input)
	return state, nil
}

func (s *feedBriefingTaskService) GetState(ctx context.Context, digestKey string) (feedBriefingTaskState, error) {
	digestKey = strings.TrimSpace(digestKey)
	state := feedBriefingTaskState{
		DigestKey: digestKey,
		Status:    articlesummary.StatusIdle,
		UpdatedAt: time.Now().UTC(),
	}
	if s == nil || s.db == nil || digestKey == "" {
		return state, nil
	}

	var task models.AITask
	result := s.db.WithContext(ctx).
		Where("task_key = ? AND kind = ?", feedBriefingTaskKey(digestKey), feedBriefingTaskKind).
		Limit(1).
		Find(&task)
	if result.Error != nil {
		return state, result.Error
	}
	if result.RowsAffected == 0 {
		return state, nil
	}
	state.Model = task.Model
	state.Status = task.Status
	state.Error = task.Error
	state.UpdatedAt = task.UpdatedAt
	return state, nil
}

func (s *feedBriefingTaskService) run(key string, input feedBriefingTaskInput) {
	defer s.release(key)
	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	s.updateState(key, articlesummary.StatusRunning, "")
	ctx, cancel := context.WithTimeout(context.Background(), feedBriefingTaskTimeout)
	defer cancel()
	if err := s.runner(ctx, input); err != nil {
		log.Printf("feed briefing async failed digest=%s model=%s err=%v", input.DigestKey, input.Model, err)
		s.updateState(key, articlesummary.StatusFailed, err.Error())
		return
	}
	s.updateState(key, articlesummary.StatusSucceeded, "")
}

func (s *feedBriefingTaskService) updateState(key string, status string, taskError string) {
	if err := s.db.Model(&models.AITask{}).
		Where("task_key = ? AND kind = ?", key, feedBriefingTaskKind).
		Updates(map[string]any{
			"status":     status,
			"error":      strings.TrimSpace(taskError),
			"updated_at": time.Now().UTC(),
		}).Error; err != nil {
		log.Printf("persist feed briefing task state key=%s status=%s: %v", key, status, err)
	}
}

func (s *feedBriefingTaskService) resumePending() {
	var tasks []models.AITask
	if err := s.db.
		Where("kind = ? AND status IN ? AND updated_at >= ?", feedBriefingTaskKind, []string{articlesummary.StatusQueued, articlesummary.StatusRunning}, time.Now().UTC().Add(-feedBriefingRecoveryAge)).
		Order("updated_at ASC").
		Limit(feedBriefingRecoveryMax).
		Find(&tasks).Error; err != nil {
		log.Printf("load pending feed briefing tasks: %v", err)
		return
	}

	for _, task := range tasks {
		var input feedBriefingTaskInput
		if err := json.Unmarshal([]byte(task.Payload), &input); err != nil || strings.TrimSpace(input.DigestKey) == "" {
			s.updateState(task.TaskKey, articlesummary.StatusFailed, "invalid persisted task payload")
			continue
		}
		s.mu.Lock()
		if _, running := s.inFlight[task.TaskKey]; running {
			s.mu.Unlock()
			continue
		}
		s.inFlight[task.TaskKey] = struct{}{}
		s.mu.Unlock()
		go s.run(task.TaskKey, input)
	}
}

func (s *feedBriefingTaskService) release(key string) {
	s.mu.Lock()
	delete(s.inFlight, key)
	s.mu.Unlock()
}

func feedBriefingTaskKey(digestKey string) string {
	return feedBriefingTaskKeyPrefix + strings.TrimSpace(digestKey)
}
