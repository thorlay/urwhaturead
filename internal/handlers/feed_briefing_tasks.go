package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"quick/internal/aitask"

	"gorm.io/gorm"
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
	runner feedBriefingTaskRunner
	tasks  *aitask.Service
}

func newFeedBriefingTaskService(db *gorm.DB, runner feedBriefingTaskRunner) *feedBriefingTaskService {
	service := &feedBriefingTaskService{runner: runner}
	if db != nil && runner != nil {
		service.tasks = aitask.NewService(db, aitask.Options{
			Kind:          feedBriefingTaskKind,
			Concurrency:   feedBriefingConcurrency,
			Timeout:       feedBriefingTaskTimeout,
			RecoveryAge:   feedBriefingRecoveryAge,
			RecoveryLimit: feedBriefingRecoveryMax,
			Runner:        service.runTask,
		})
	}
	return service
}

func (s *feedBriefingTaskService) Enqueue(input feedBriefingTaskInput) (feedBriefingTaskState, error) {
	if s == nil || s.tasks == nil || s.runner == nil {
		return feedBriefingTaskState{}, errors.New("feed briefing task service is not configured")
	}
	input.DigestKey = strings.TrimSpace(input.DigestKey)
	if input.DigestKey == "" {
		return feedBriefingTaskState{}, errors.New("feed briefing digest key is empty")
	}

	payload, err := json.Marshal(input)
	if err != nil {
		return feedBriefingTaskState{}, err
	}
	state, err := s.tasks.Enqueue(aitask.Task{
		Key:     feedBriefingTaskKey(input.DigestKey),
		Model:   input.Model,
		Refresh: input.Refresh,
		Payload: string(payload),
	})
	if err != nil {
		return feedBriefingTaskState{}, err
	}
	return toFeedBriefingTaskState(input.DigestKey, input.Model, state), nil
}

func (s *feedBriefingTaskService) GetState(ctx context.Context, digestKey string) (feedBriefingTaskState, error) {
	digestKey = strings.TrimSpace(digestKey)
	state := feedBriefingTaskState{
		DigestKey: digestKey,
		Status:    aitask.StatusIdle,
		UpdatedAt: time.Now().UTC(),
	}
	if s == nil || s.tasks == nil || digestKey == "" {
		return state, nil
	}

	taskState, err := s.tasks.GetState(ctx, feedBriefingTaskKey(digestKey))
	if err != nil {
		return state, err
	}
	return toFeedBriefingTaskState(digestKey, "", taskState), nil
}

func (s *feedBriefingTaskService) runTask(ctx context.Context, task aitask.Task) error {
	var input feedBriefingTaskInput
	if err := json.Unmarshal([]byte(task.Payload), &input); err != nil || strings.TrimSpace(input.DigestKey) == "" {
		return errors.New("invalid persisted task payload")
	}
	return s.runner(ctx, input)
}

func feedBriefingTaskKey(digestKey string) string {
	return feedBriefingTaskKeyPrefix + strings.TrimSpace(digestKey)
}

func toFeedBriefingTaskState(digestKey, model string, state aitask.State) feedBriefingTaskState {
	if strings.TrimSpace(model) == "" {
		model = state.Model
	}
	return feedBriefingTaskState{
		DigestKey: strings.TrimSpace(digestKey),
		Model:     strings.TrimSpace(model),
		Status:    state.Status,
		Error:     state.Error,
		UpdatedAt: state.UpdatedAt,
	}
}
