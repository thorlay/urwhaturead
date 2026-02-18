package aisummary

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSummarize(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("unexpected auth header: %s", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"test-model","choices":[{"message":{"content":"summary text"}}]}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL:       server.URL + "/v1",
		APIKey:        "secret",
		Model:         "demo",
		Timeout:       2 * time.Second,
		MaxInputChars: 20,
	})

	result, err := client.Summarize(context.Background(), "Title", strings.Repeat("a", 30))
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if result.Summary != "summary text" {
		t.Fatalf("unexpected summary: %q", result.Summary)
	}
	if result.Model != "test-model" {
		t.Fatalf("unexpected model: %q", result.Model)
	}
	if !result.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if result.InputChars != 20 {
		t.Fatalf("unexpected input chars: %d", result.InputChars)
	}
}

func TestNewClient_NotConfigured(t *testing.T) {
	client := NewClient(Options{
		BaseURL: "",
		APIKey:  "",
		Model:   "",
	})
	if client != nil {
		t.Fatalf("expected nil client when options are empty")
	}
}
