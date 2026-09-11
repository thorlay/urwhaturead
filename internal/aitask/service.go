package aitask

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"quick/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	StatusIdle      = "idle"
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
)

type Task struct {
	Key        string
	ResourceID uint64
	Model      string
	Refresh    bool
	Payload    string
}

type State struct {
	Model     string
	Status    string
	Error     string
	UpdatedAt time.Time
}

type Runner func(context.Context, Task) error

type Options struct {
	Kind          string
	Concurrency   int
	Timeout       time.Duration
	RecoveryAge   time.Duration
	RecoveryLimit int
	StateTTL      time.Duration
	Runner        Runner
}

type Service struct {
	db      *gorm.DB
	options Options
	sem     chan struct{}

	mu       sync.Mutex
	states   map[string]State
	inFlight map[string]struct{}
}

func NewService(db *gorm.DB, options Options) *Service {
	options.Kind = strings.TrimSpace(options.Kind)
	if options.Concurrency <= 0 {
		options.Concurrency = 1
	}
	if options.Timeout <= 0 {
		options.Timeout = 2 * time.Minute
	}
	if options.RecoveryAge <= 0 {
		options.RecoveryAge = 7 * 24 * time.Hour
	}
	if options.RecoveryLimit <= 0 {
		options.RecoveryLimit = 100
	}
	if options.StateTTL <= 0 {
		options.StateTTL = 15 * time.Minute
	}

	service := &Service{
		db:       db,
		options:  options,
		sem:      make(chan struct{}, options.Concurrency),
		states:   make(map[string]State),
		inFlight: make(map[string]struct{}),
	}
	if service.IsConfigured() {
		go service.resumePending()
	}
	return service
}

func (s *Service) IsConfigured() bool {
	return s != nil && s.db != nil && s.options.Kind != "" && s.options.Runner != nil
}

func (s *Service) Enqueue(task Task) (State, error) {
	if !s.IsConfigured() {
		return State{}, errors.New("AI task service is not configured")
	}
	task.Key = strings.TrimSpace(task.Key)
	if task.Key == "" {
		return State{}, errors.New("AI task key is empty")
	}
	task.Model = strings.TrimSpace(task.Model)
	if strings.TrimSpace(task.Payload) == "" {
		task.Payload = "{}"
	}

	now := time.Now().UTC()
	s.mu.Lock()
	s.pruneStatesLocked(now)
	if _, running := s.inFlight[task.Key]; running {
		state, ok := s.states[task.Key]
		if !ok {
			state = State{Model: task.Model, Status: StatusRunning, UpdatedAt: now}
			s.states[task.Key] = state
		}
		s.mu.Unlock()
		return state, nil
	}
	state := State{Model: task.Model, Status: StatusQueued, UpdatedAt: now}
	s.inFlight[task.Key] = struct{}{}
	s.states[task.Key] = state
	s.mu.Unlock()

	if err := s.persist(task, state); err != nil {
		s.mu.Lock()
		delete(s.inFlight, task.Key)
		state = State{
			Model:     task.Model,
			Status:    StatusFailed,
			Error:     "save task state failed: " + err.Error(),
			UpdatedAt: time.Now().UTC(),
		}
		s.states[task.Key] = state
		s.mu.Unlock()
		return state, err
	}

	go s.run(task)
	return state, nil
}

func (s *Service) GetState(ctx context.Context, key string) (State, error) {
	key = strings.TrimSpace(key)
	now := time.Now().UTC()
	if key == "" || s == nil {
		return State{Status: StatusIdle, UpdatedAt: now}, nil
	}

	s.mu.Lock()
	s.pruneStatesLocked(now)
	state, ok := s.states[key]
	s.mu.Unlock()
	if ok {
		return state, nil
	}
	if s.db == nil {
		return State{Status: StatusIdle, UpdatedAt: now}, nil
	}

	var task models.AITask
	result := s.db.WithContext(ctx).
		Where("task_key = ? AND kind = ?", key, s.options.Kind).
		Limit(1).
		Find(&task)
	if result.Error != nil {
		return State{}, result.Error
	}
	if result.RowsAffected == 0 {
		return State{Status: StatusIdle, UpdatedAt: now}, nil
	}
	return State{Model: task.Model, Status: task.Status, Error: task.Error, UpdatedAt: task.UpdatedAt}, nil
}

func (s *Service) run(task Task) {
	defer s.release(task.Key)
	s.sem <- struct{}{}
	defer func() { <-s.sem }()
	defer func() {
		if recovered := recover(); recovered != nil {
			err := fmt.Errorf("task panicked: %v", recovered)
			log.Printf("AI task panic kind=%s key=%s resource_id=%d model=%s err=%v", s.options.Kind, task.Key, task.ResourceID, task.Model, err)
			s.setState(task.Key, StatusFailed, err.Error())
		}
	}()

	s.setState(task.Key, StatusRunning, "")
	ctx, cancel := context.WithTimeout(context.Background(), s.options.Timeout)
	defer cancel()
	if err := s.options.Runner(ctx, task); err != nil {
		log.Printf("AI task failed kind=%s key=%s resource_id=%d model=%s err=%v", s.options.Kind, task.Key, task.ResourceID, task.Model, err)
		s.setState(task.Key, StatusFailed, err.Error())
		return
	}
	s.setState(task.Key, StatusSucceeded, "")
}

func (s *Service) persist(task Task, state State) error {
	record := models.AITask{
		TaskKey:    task.Key,
		Kind:       s.options.Kind,
		ResourceID: task.ResourceID,
		Model:      task.Model,
		Refresh:    task.Refresh,
		Payload:    task.Payload,
		Status:     state.Status,
		Error:      state.Error,
		CreatedAt:  state.UpdatedAt,
		UpdatedAt:  state.UpdatedAt,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "task_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"kind", "resource_id", "model", "refresh", "payload", "status", "error", "updated_at",
		}),
	}).Create(&record).Error
}

func (s *Service) setState(key, status, taskError string) {
	now := time.Now().UTC()
	taskError = strings.TrimSpace(taskError)
	s.mu.Lock()
	s.pruneStatesLocked(now)
	state := s.states[key]
	state.Status = status
	state.Error = taskError
	state.UpdatedAt = now
	s.states[key] = state
	s.mu.Unlock()

	if err := s.db.Model(&models.AITask{}).
		Where("task_key = ? AND kind = ?", key, s.options.Kind).
		Updates(map[string]any{
			"status":     status,
			"error":      taskError,
			"updated_at": now,
		}).Error; err != nil {
		log.Printf("persist AI task state kind=%s key=%s status=%s: %v", s.options.Kind, key, status, err)
	}
}

func (s *Service) resumePending() {
	var records []models.AITask
	if err := s.db.
		Where("kind = ? AND status IN ? AND updated_at >= ?", s.options.Kind, []string{StatusQueued, StatusRunning}, time.Now().UTC().Add(-s.options.RecoveryAge)).
		Order("updated_at ASC").
		Limit(s.options.RecoveryLimit).
		Find(&records).Error; err != nil {
		log.Printf("load pending AI tasks kind=%s: %v", s.options.Kind, err)
		return
	}

	for _, record := range records {
		task := Task{
			Key:        record.TaskKey,
			ResourceID: record.ResourceID,
			Model:      record.Model,
			Refresh:    record.Refresh,
			Payload:    record.Payload,
		}
		now := time.Now().UTC()
		s.mu.Lock()
		if _, running := s.inFlight[task.Key]; running {
			s.mu.Unlock()
			continue
		}
		s.inFlight[task.Key] = struct{}{}
		s.states[task.Key] = State{Model: task.Model, Status: StatusQueued, UpdatedAt: now}
		s.mu.Unlock()
		go s.run(task)
	}
}

func (s *Service) release(key string) {
	s.mu.Lock()
	delete(s.inFlight, key)
	s.mu.Unlock()
}

func (s *Service) pruneStatesLocked(now time.Time) {
	for key, state := range s.states {
		if now.Sub(state.UpdatedAt) <= s.options.StateTTL {
			continue
		}
		if _, running := s.inFlight[key]; running {
			continue
		}
		delete(s.states, key)
	}
}
