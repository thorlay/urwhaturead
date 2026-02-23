package articlesummary

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"quick/internal/aisummary"
	"quick/internal/models"

	"gorm.io/gorm"
)

const (
	asyncConcurrency = 2
	asyncTimeout     = 2 * time.Minute
	taskStateTTL     = 15 * time.Minute
)

const (
	StatusIdle      = "idle"
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
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

	taskMu   sync.Mutex
	tasks    map[string]TaskState
	inFlight map[string]struct{}
	sem      chan struct{}
}

func NewService(db *gorm.DB, summarizer *aisummary.Client, loadInput Loader) *Service {
	return &Service{
		db:         db,
		summarizer: summarizer,
		loadInput:  loadInput,
		tasks:      make(map[string]TaskState),
		inFlight:   make(map[string]struct{}),
		sem:        make(chan struct{}, asyncConcurrency),
	}
}

func (s *Service) IsConfigured() bool {
	return s != nil && s.db != nil && s.summarizer != nil && s.loadInput != nil
}

func (s *Service) EnqueueTask(articleID uint64, requestedModel string, refresh bool) TaskPayload {
	key := taskKey(articleID, requestedModel)
	now := time.Now().UTC()

	s.taskMu.Lock()
	s.pruneTaskStateLocked(now)

	if _, running := s.inFlight[key]; running {
		state, ok := s.tasks[key]
		if !ok {
			state = TaskState{
				Status:    StatusRunning,
				UpdatedAt: now,
			}
			s.tasks[key] = state
		}
		s.taskMu.Unlock()
		return toTaskPayload(articleID, requestedModel, state)
	}

	state := TaskState{
		Status:    StatusQueued,
		UpdatedAt: now,
	}
	s.inFlight[key] = struct{}{}
	s.tasks[key] = state
	s.taskMu.Unlock()

	go s.runTask(key, articleID, requestedModel, refresh)
	return toTaskPayload(articleID, requestedModel, state)
}

func (s *Service) runTask(key string, articleID uint64, requestedModel string, refresh bool) {
	defer func() {
		s.taskMu.Lock()
		delete(s.inFlight, key)
		s.taskMu.Unlock()
	}()

	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	s.setTaskState(key, StatusRunning, "")

	ctx, cancel := context.WithTimeout(context.Background(), asyncTimeout)
	defer cancel()

	if !refresh {
		if _, found, err := s.GetCachedPayload(ctx, articleID, requestedModel); err == nil && found {
			s.setTaskState(key, StatusSucceeded, "")
			return
		}
	}

	_, stage, err := s.GenerateAndSave(ctx, articleID, requestedModel)
	if err != nil {
		log.Printf(
			"summary async failed article_id=%d stage=%s model=%s err=%v",
			articleID,
			stage,
			firstNonEmpty(requestedModel, "<default>"),
			err,
		)
		s.setTaskState(key, StatusFailed, summarizeTaskError(stage, err))
		return
	}

	s.setTaskState(key, StatusSucceeded, "")
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
		Provider:    result.ProviderName,
		GeneratedAt: result.GeneratedAt,
		CacheHit:    false,
	}, "", nil
}

func (s *Service) GetTaskState(articleID uint64, requestedModel string) TaskState {
	now := time.Now().UTC()
	key := taskKey(articleID, requestedModel)
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	s.pruneTaskStateLocked(now)
	state, ok := s.tasks[key]
	if !ok {
		return TaskState{
			Status:    StatusIdle,
			UpdatedAt: now,
		}
	}
	return state
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
		Provider:    cached.Provider,
		GeneratedAt: cached.GeneratedAt,
		CacheHit:    true,
	}, true, nil
}

func (s *Service) setTaskState(key string, status string, taskError string) {
	now := time.Now().UTC()
	s.taskMu.Lock()
	s.pruneTaskStateLocked(now)
	s.tasks[key] = TaskState{
		Status:    status,
		Error:     strings.TrimSpace(taskError),
		UpdatedAt: now,
	}
	s.taskMu.Unlock()
}

func (s *Service) pruneTaskStateLocked(now time.Time) {
	if len(s.tasks) == 0 {
		return
	}
	for key, state := range s.tasks {
		if now.Sub(state.UpdatedAt) <= taskStateTTL {
			continue
		}
		if _, running := s.inFlight[key]; running {
			continue
		}
		delete(s.tasks, key)
	}
}

func taskKey(articleID uint64, requestedModel string) string {
	return strconv.FormatUint(articleID, 10) + "|" + strings.ToLower(strings.TrimSpace(requestedModel))
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
