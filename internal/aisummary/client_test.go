package aisummary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

func TestSummarize_MessagesAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/gemini-cli-oauth/v1/messages" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("X-API-Key"); got != "secret-key" {
			t.Fatalf("unexpected X-API-Key header: %s", got)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if model := payload["model"]; model != "gemini-2.0-flash-exp" {
			t.Fatalf("unexpected model: %#v", model)
		}
		if maxTokens := payload["max_tokens"]; maxTokens != float64(1000) {
			t.Fatalf("unexpected max_tokens: %#v", maxTokens)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gemini-2.0-flash-exp","content":[{"type":"text","text":"summary from messages api"}]}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL:         server.URL + "/gemini-cli-oauth/v1/messages",
		APIKey:          "secret-key",
		Model:           "gemini-2.0-flash-exp",
		Timeout:         2 * time.Second,
		MaxInputChars:   200,
		MaxOutputTokens: 1000,
	})
	if client == nil {
		t.Fatalf("client should not be nil")
	}

	result, err := client.Summarize(context.Background(), "Title", "Body text")
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if result.Summary != "summary from messages api" {
		t.Fatalf("unexpected summary: %q", result.Summary)
	}
	if result.Model != "gemini-2.0-flash-exp" {
		t.Fatalf("unexpected model: %q", result.Model)
	}
}

func TestSummarize_EmptyWithAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":{"message":"model not available"}}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL: server.URL + "/v1/chat/completions",
		APIKey:  "secret",
		Model:   "demo",
		Timeout: 2 * time.Second,
	})
	if client == nil {
		t.Fatalf("client should not be nil")
	}

	_, err := client.Summarize(context.Background(), "Title", "Body text")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "model not available") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSummarizeWithModel_Override(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if model := payload["model"]; model != "gemini-3.1-pro-preview" {
			t.Fatalf("unexpected model: %#v", model)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"override summary"}}]}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL: server.URL + "/v1/chat/completions",
		APIKey:  "secret",
		Model:   "gemini-2.5-flash",
		Timeout: 2 * time.Second,
	})
	if client == nil {
		t.Fatalf("client should not be nil")
	}

	result, err := client.SummarizeWithModel(context.Background(), "Title", "Body text", "gemini-3.1-pro-preview")
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if result.Summary != "override summary" {
		t.Fatalf("unexpected summary: %q", result.Summary)
	}
	if result.Model != "gemini-3.1-pro-preview" {
		t.Fatalf("unexpected model fallback: %q", result.Model)
	}
}

func TestSummarize_RetryOnMaxTokensEmpty(t *testing.T) {
	var calls int32
	var secondCallUserContent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call := atomic.AddInt32(&calls, 1)
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		if call == 1 {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"gemini-2.5-flash","content":[],"stop_reason":"max_tokens"}`))
			return
		}

		rawMessages, _ := payload["messages"].([]any)
		if len(rawMessages) < 2 {
			t.Fatalf("expected openai chat messages payload with system+user")
		}
		userMessage, _ := rawMessages[1].(map[string]any)
		secondCallUserContent, _ = userMessage["content"].(string)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gemini-2.5-flash","choices":[{"message":{"content":"retry summary ok"}}]}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL:         server.URL + "/v1/chat/completions",
		APIKey:          "secret",
		Model:           "gemini-2.5-flash",
		Timeout:         2 * time.Second,
		MaxInputChars:   8000,
		MaxOutputTokens: 1200,
		APIStyle:        "openai_chat",
	})
	if client == nil {
		t.Fatalf("client should not be nil")
	}

	result, err := client.Summarize(context.Background(), "title", strings.Repeat("x", 9000))
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if result.Summary != "retry summary ok" {
		t.Fatalf("unexpected summary: %q", result.Summary)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("calls=%d, want=2", got)
	}
	if !strings.Contains(secondCallUserContent, "紧凑摘要") {
		t.Fatalf("expected compact retry prompt, got=%q", secondCallUserContent)
	}
}

func TestSummarize_MarksPartialMaxTokensAsTruncated(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gemini-3.1-pro-preview","choices":[{"message":{"content":"half done summary"},"finish_reason":"max_tokens"}]}`))
	}))
	defer server.Close()

	client := NewClient(Options{
		BaseURL:         server.URL + "/v1/chat/completions",
		APIKey:          "secret",
		Model:           "gemini-3.1-pro-preview",
		Timeout:         2 * time.Second,
		MaxInputChars:   8000,
		MaxOutputTokens: 1200,
		APIStyle:        "openai_chat",
	})
	if client == nil {
		t.Fatalf("client should not be nil")
	}

	result, err := client.Summarize(context.Background(), "title", "body text")
	if err != nil {
		t.Fatalf("summarize failed: %v", err)
	}
	if result.Summary != "half done summary" {
		t.Fatalf("unexpected summary: %q", result.Summary)
	}
	if !result.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if result.StopReason != "max_tokens" {
		t.Fatalf("unexpected stop reason: %q", result.StopReason)
	}
}
