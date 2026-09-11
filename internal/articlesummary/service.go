package articlesummary

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"quick/internal/aisummary"
	"quick/internal/aitask"
	"quick/internal/models"

	"gorm.io/gorm"
)

const (
	asyncConcurrency = 2
	asyncTimeout     = 2 * time.Minute
	taskStateTTL     = 15 * time.Minute
	taskRecoveryAge  = 7 * 24 * time.Hour
	taskRecoveryMax  = 100
	articleTaskKind  = "article_summary"
)

const (
	StatusIdle      = aitask.StatusIdle
	StatusQueued    = aitask.StatusQueued
	StatusRunning   = aitask.StatusRunning
	StatusSucceeded = aitask.StatusSucceeded
	StatusFailed    = aitask.StatusFailed
)

type ArticleInput struct {
	ID         uint64
	Title      string
	SourceText string
}

type Loader func(ctx context.Context, articleID uint64) (ArticleInput, error)

type SummaryPayload struct {
	ArticleID   uint64    `json:"article_id"`
	Summary     string    `json:"summary"`
	Model       string    `json:"model"`
	InputChars  int       `json:"input_chars"`
	Truncated   bool      `json:"truncated"`
	StopReason  string    `json:"stop_reason"`
	Provider    string    `json:"provider"`
	GeneratedAt time.Time `json:"generated_at"`
	CacheHit    bool      `json:"cache_hit"`
}

type TaskPayload struct {
	ArticleID uint64    `json:"article_id"`
	Model     string    `json:"model"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TaskState struct {
	Status    string
	Error     string
	UpdatedAt time.Time
}

type Service struct {
	db         *gorm.DB
	summarizer *aisummary.Client
	loadInput  Loader

	tasks *aitask.Service
}

func NewService(db *gorm.DB, summarizer *aisummary.Client, loadInput Loader) *Service {
	service := &Service{
		db:         db,
		summarizer: summarizer,
		loadInput:  loadInput,
	}
	if service.db != nil && service.summarizer != nil && service.loadInput != nil {
		service.tasks = aitask.NewService(db, aitask.Options{
			Kind:          articleTaskKind,
			Concurrency:   asyncConcurrency,
			Timeout:       asyncTimeout,
			RecoveryAge:   taskRecoveryAge,
			RecoveryLimit: taskRecoveryMax,
			StateTTL:      taskStateTTL,
			Runner:        service.runTask,
		})
	}
	return service
}

func (s *Service) IsConfigured() bool {
	return s != nil && s.db != nil && s.summarizer != nil && s.loadInput != nil && s.tasks != nil
}

func (s *Service) EnqueueTask(articleID uint64, requestedModel string, refresh bool) TaskPayload {
	if !s.IsConfigured() {
		return toTaskPayload(articleID, requestedModel, TaskState{
			Status: StatusFailed, Error: "summary service is not configured", UpdatedAt: time.Now().UTC(),
		})
	}
	state, _ := s.tasks.Enqueue(aitask.Task{
		Key:        taskKey(articleID, requestedModel),
		ResourceID: articleID,
		Model:      requestedModel,
		Refresh:    refresh,
	})
	return toTaskPayload(articleID, requestedModel, fromAITaskState(state))
}

func (s *Service) runTask(ctx context.Context, task aitask.Task) error {
	if !task.Refresh {
		if _, found, err := s.GetCachedPayload(ctx, task.ResourceID, task.Model); err == nil && found {
			return nil
		}
	}

	_, stage, err := s.GenerateAndSave(ctx, task.ResourceID, task.Model)
	if err != nil {
		return errors.New(summarizeTaskError(stage, err))
	}
	return nil
}

func (s *Service) GenerateAndSave(
	ctx context.Context,
	articleID uint64,
	requestedModel string,
) (SummaryPayload, string, error) {
	if s == nil || s.db == nil || s.loadInput == nil {
		return SummaryPayload{}, "load", errors.New("summary service is not configured")
	}
	if s.summarizer == nil {
		return SummaryPayload{}, "ai", aisummary.ErrNotConfigured
	}

	input, err := s.loadInput(ctx, articleID)
	if err != nil {
		return SummaryPayload{}, "load", err
	}

	text := strings.TrimSpace(input.SourceText)
	if text == "" {
		return SummaryPayload{}, "empty", errors.New("article content is empty")
	}

	result, err := s.summarizer.SummarizeWithModel(ctx, input.Title, text, requestedModel)
	if err != nil {
		return SummaryPayload{}, "ai", err
	}

	summaryRecord := models.ArticleSummary{
		ArticleID:   articleID,
		Summary:     result.Summary,
		Model:       result.Model,
		Provider:    result.ProviderName,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		StopReason:  result.StopReason,
		GeneratedAt: result.GeneratedAt,
	}
	if err := s.db.WithContext(ctx).
		Where("article_id = ?", articleID).
		Assign(summaryRecord).
		FirstOrCreate(&summaryRecord).Error; err != nil {
		return SummaryPayload{}, "save", err
	}

	return SummaryPayload{
		ArticleID:   input.ID,
		Summary:     result.Summary,
		Model:       result.Model,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		StopReason:  result.StopReason,
		Provider:    result.ProviderName,
		GeneratedAt: result.GeneratedAt,
		CacheHit:    false,
	}, "", nil
}

func (s *Service) GetTaskState(ctx context.Context, articleID uint64, requestedModel string) TaskState {
	if s == nil || s.tasks == nil {
		return TaskState{Status: StatusIdle, UpdatedAt: time.Now().UTC()}
	}
	state, err := s.tasks.GetState(ctx, taskKey(articleID, requestedModel))
	if err != nil {
		return TaskState{Status: StatusFailed, Error: err.Error(), UpdatedAt: time.Now().UTC()}
	}
	return fromAITaskState(state)
}

func (s *Service) GetCachedPayload(ctx context.Context, articleID uint64, requestedModel string) (SummaryPayload, bool, error) {
	if s == nil || s.db == nil {
		return SummaryPayload{}, false, errors.New("summary service is not configured")
	}

	var cached models.ArticleSummary
	err := s.db.WithContext(ctx).
		Where("article_id = ?", articleID).
		Take(&cached).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return SummaryPayload{}, false, nil
		}
		return SummaryPayload{}, false, err
	}
	if requestedModel = strings.TrimSpace(requestedModel); requestedModel != "" && !strings.EqualFold(strings.TrimSpace(cached.Model), requestedModel) {
		return SummaryPayload{}, false, nil
	}

	return SummaryPayload{
		ArticleID:   articleID,
		Summary:     cached.Summary,
		Model:       cached.Model,
		InputChars:  cached.InputChars,
		Truncated:   cached.Truncated,
		StopReason:  cached.StopReason,
		Provider:    cached.Provider,
		GeneratedAt: cached.GeneratedAt,
		CacheHit:    true,
	}, true, nil
}

func taskKey(articleID uint64, requestedModel string) string {
	return strconv.FormatUint(articleID, 10) + "|" + strings.ToLower(strings.TrimSpace(requestedModel))
}

func fromAITaskState(state aitask.State) TaskState {
	return TaskState{Status: state.Status, Error: state.Error, UpdatedAt: state.UpdatedAt}
}

func toTaskPayload(articleID uint64, requestedModel string, state TaskState) TaskPayload {
	return TaskPayload{
		ArticleID: articleID,
		Model:     strings.TrimSpace(requestedModel),
		Status:    state.Status,
		Error:     state.Error,
		UpdatedAt: state.UpdatedAt,
	}
}

func summarizeTaskError(stage string, err error) string {
	if err == nil {
		return ""
	}
	switch stage {
	case "load":
		return "load article failed: " + err.Error()
	case "empty":
		return "article content is empty"
	case "ai":
		return err.Error()
	case "save":
		return "save summary cache failed: " + err.Error()
	default:
		return err.Error()
	}
}
