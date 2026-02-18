package aisummary

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	defaultTimeout       = 60 * time.Second
	defaultMaxInputChars = 12000
)

var (
	ErrNotConfigured = errors.New("ai summary client is not configured")
	ErrEmptyInput    = errors.New("empty input")
)

type Options struct {
	BaseURL       string
	APIKey        string
	Model         string
	Timeout       time.Duration
	MaxInputChars int
}

type Result struct {
	Summary      string
	Model        string
	InputChars   int
	Truncated    bool
	GeneratedAt  time.Time
	ProviderName string
}

type Client struct {
	baseURL       string
	apiKey        string
	model         string
	httpClient    *http.Client
	maxInputChars int
}

const defaultSummarySystemPrompt = "你是一个新闻/论坛内容摘要助手。输出中文，准确、简洁、结构化。"

func NewClient(options Options) *Client {
	baseURL := strings.TrimSuffix(strings.TrimSpace(options.BaseURL), "/")
	apiKey := strings.TrimSpace(options.APIKey)
	model := strings.TrimSpace(options.Model)
	if baseURL == "" || apiKey == "" || model == "" {
		return nil
	}

	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	maxInputChars := options.MaxInputChars
	if maxInputChars <= 0 {
		maxInputChars = defaultMaxInputChars
	}

	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		model:   model,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		maxInputChars: maxInputChars,
	}
}

func (c *Client) Summarize(ctx context.Context, title string, content string) (Result, error) {
	if c == nil {
		return Result{}, ErrNotConfigured
	}

	input := strings.TrimSpace(content)
	if input == "" {
		return Result{}, ErrEmptyInput
	}

	truncated := false
	if len(input) > c.maxInputChars {
		input = input[:c.maxInputChars]
		truncated = true
	}

	prompt := buildPrompt(strings.TrimSpace(title), input)
	return c.complete(ctx, defaultSummarySystemPrompt, prompt, len(input), truncated)
}

func (c *Client) Complete(ctx context.Context, systemPrompt string, userPrompt string) (Result, error) {
	if c == nil {
		return Result{}, ErrNotConfigured
	}

	system := strings.TrimSpace(systemPrompt)
	if system == "" {
		system = defaultSummarySystemPrompt
	}

	input := strings.TrimSpace(userPrompt)
	if input == "" {
		return Result{}, ErrEmptyInput
	}

	truncated := false
	if len(input) > c.maxInputChars {
		input = input[:c.maxInputChars]
		truncated = true
	}

	return c.complete(ctx, system, input, len(input), truncated)
}

func (c *Client) complete(
	ctx context.Context,
	systemPrompt string,
	userPrompt string,
	inputChars int,
	truncated bool,
) (Result, error) {
	payload := map[string]any{
		"model": c.model,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": systemPrompt,
			},
			{
				"role":    "user",
				"content": userPrompt,
			},
		},
		"temperature": 0.2,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("request ai summary failed: %w", err)
	}
	defer resp.Body.Close()

	rawRespBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Result{}, fmt.Errorf("read ai response failed: %w", err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return Result{}, fmt.Errorf("ai summary status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(rawRespBody)))
	}

	var parsed struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(rawRespBody, &parsed); err != nil {
		return Result{}, fmt.Errorf("parse ai response failed: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Result{}, fmt.Errorf("ai response choices is empty")
	}

	summary := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if summary == "" {
		return Result{}, fmt.Errorf("ai summary is empty")
	}

	resultModel := strings.TrimSpace(parsed.Model)
	if resultModel == "" {
		resultModel = c.model
	}

	return Result{
		Summary:      summary,
		Model:        resultModel,
		InputChars:   inputChars,
		Truncated:    truncated,
		GeneratedAt:  time.Now().UTC(),
		ProviderName: "geminicli2api",
	}, nil
}

func buildPrompt(title string, content string) string {
	var builder strings.Builder
	if title != "" {
		builder.WriteString("标题：")
		builder.WriteString(title)
		builder.WriteString("\n\n")
	}
	builder.WriteString("请对下面长文进行总结，输出格式严格为：\n")
	builder.WriteString("1) 三句话总结\n")
	builder.WriteString("2) 关键观点（最多5条）\n")
	builder.WriteString("3) 风险/争议点（最多3条）\n")
	builder.WriteString("4) 对读者的可执行建议（最多3条）\n\n")
	builder.WriteString("正文：\n")
	builder.WriteString(content)
	return builder.String()
}
