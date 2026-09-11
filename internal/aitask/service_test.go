package aitask

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestServiceDeduplicatesInFlightTask(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var runs atomic.Int32
	service := newDryRunService(t, Options{
		Kind: "test_deduplicate",
		Runner: func(context.Context, Task) error {
			if runs.Add(1) == 1 {
				close(started)
			}
			<-release
			return nil
		},
	})

	first, err := service.Enqueue(Task{Key: "same", Model: "test-model"})
	if err != nil {
		t.Fatalf("enqueue first task: %v", err)
	}
	if first.Status != StatusQueued || first.Model != "test-model" {
		t.Fatalf("first state = %+v", first)
	}
	waitForSignal(t, started)

	second, err := service.Enqueue(Task{Key: "same", Model: "test-model"})
	if err != nil {
		t.Fatalf("enqueue duplicate task: %v", err)
	}
	if second.Status != StatusRunning {
		t.Fatalf("duplicate status = %q, want %q", second.Status, StatusRunning)
	}
	if got := runs.Load(); got != 1 {
		t.Fatalf("runner calls = %d, want 1", got)
	}

	close(release)
	waitForStatus(t, service, "same", StatusSucceeded)
}

func TestServiceHonorsConcurrencyLimit(t *testing.T) {
	release := make(chan struct{})
	var active atomic.Int32
	var maxActive atomic.Int32
	service := newDryRunService(t, Options{
		Kind:        "test_concurrency",
		Concurrency: 1,
		Runner: func(context.Context, Task) error {
			current := active.Add(1)
			defer active.Add(-1)
			for {
				maximum := maxActive.Load()
				if current <= maximum || maxActive.CompareAndSwap(maximum, current) {
					break
				}
			}
			<-release
			return nil
		},
	})

	if _, err := service.Enqueue(Task{Key: "one"}); err != nil {
		t.Fatalf("enqueue first task: %v", err)
	}
	if _, err := service.Enqueue(Task{Key: "two"}); err != nil {
		t.Fatalf("enqueue second task: %v", err)
	}
	waitForCondition(t, func() bool { return active.Load() == 1 })
	time.Sleep(20 * time.Millisecond)
	if got := maxActive.Load(); got != 1 {
		t.Fatalf("maximum concurrent runners = %d, want 1", got)
	}
	close(release)
	waitForStatus(t, service, "one", StatusSucceeded)
	waitForStatus(t, service, "two", StatusSucceeded)
}

func TestServiceRecordsTimeoutAndPanic(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		service := newDryRunService(t, Options{
			Kind:    "test_timeout",
			Timeout: 10 * time.Millisecond,
			Runner: func(ctx context.Context, _ Task) error {
				<-ctx.Done()
				return ctx.Err()
			},
		})
		if _, err := service.Enqueue(Task{Key: "timeout"}); err != nil {
			t.Fatalf("enqueue timeout task: %v", err)
		}
		state := waitForStatus(t, service, "timeout", StatusFailed)
		if !strings.Contains(state.Error, "deadline exceeded") {
			t.Fatalf("timeout error = %q", state.Error)
		}
	})

	t.Run("panic", func(t *testing.T) {
		service := newDryRunService(t, Options{
			Kind: "test_panic",
			Runner: func(context.Context, Task) error {
				panic("boom")
			},
		})
		if _, err := service.Enqueue(Task{Key: "panic"}); err != nil {
			t.Fatalf("enqueue panic task: %v", err)
		}
		state := waitForStatus(t, service, "panic", StatusFailed)
		if state.Error != "task panicked: boom" {
			t.Fatalf("panic error = %q", state.Error)
		}
	})
}

func newDryRunService(t *testing.T, options Options) *Service {
	t.Helper()
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN: "host=localhost user=test dbname=test sslmode=disable",
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}
	return NewService(db, options)
}

func waitForSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runner")
	}
}

func waitForStatus(t *testing.T, service *Service, key, status string) State {
	t.Helper()
	var state State
	waitForCondition(t, func() bool {
		state, _ = service.GetState(context.Background(), key)
		return state.Status == status
	})
	return state
}

func waitForCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}
