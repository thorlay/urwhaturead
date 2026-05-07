package aisummary

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultTimeout         = 60 * time.Second
	defaultMaxInputChars   = 12000
	defaultMaxOutputTokens = 1000
	apiStyleAuto           = "auto"
	apiStyleOpenAIChat     = "openai_chat"
	apiStyleMessages       = "messages"
)

var (
	ErrNotConfigured = errors.New("ai summary client is not configured")
	ErrEmptyInput    = errors.New("empty input")
)

type Options struct {
	BaseURL         string
	APIKey          string
	Model           string
	Timeout         time.Duration
	MaxInputChars   int
	MaxOutputTokens int
	APIStyle        string
	APIKeyHeader    string
	APIKeyPrefix    string
}

type Result struct {
	Summary      string
	Model        string
	InputChars   int
	Truncated    bool
	StopReason   string
	GeneratedAt  time.Time
	ProviderName string
}

type Client struct {
	endpointURL     string
	apiStyle        string
	apiKey          string
	apiKeyHeader    string
	apiKeyPrefix    string
	model           string
	httpClient      *http.Client
	maxInputChars   int
	maxOutputTokens int
}

func (c *Client) DefaultModel() string {
	if c == nil {
		return ""
	}
	return strings.TrimSpace(c.model)
}

const defaultSummarySystemPrompt = "你是一个中文编辑台摘要助手。你的任务不是复述，而是提炼信息。输出中文，优先保留事实、证据、结论、争议和可执行信息；避免空话、套话、模板化过渡句和无根据延伸。不确定的信息明确写“原文未说明”。"

func NewClient(options Options) *Client {
	baseURL := strings.TrimSpace(options.BaseURL)
	apiKey := strings.TrimSpace(options.APIKey)
	model := strings.TrimSpace(options.Model)
	if baseURL == "" || apiKey == "" || model == "" {
		return nil
	}

	style := normalizeAPIStyle(options.APIStyle)
	if style == apiStyleAuto {
		style = detectAPIStyle(baseURL)
	}
	endpointURL := normalizeEndpointURL(baseURL, style)
	if endpointURL == "" {
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
	maxOutputTokens := options.MaxOutputTokens
	if maxOutputTokens <= 0 {
		maxOutputTokens = defaultMaxOutputTokens
	}

	apiKeyHeader := strings.TrimSpace(options.APIKeyHeader)
	if apiKeyHeader == "" {
		if style == apiStyleMessages {
			apiKeyHeader = "X-API-Key"
		} else {
			apiKeyHeader = "Authorization"
		}
	}
	apiKeyPrefix := options.APIKeyPrefix
	if apiKeyPrefix == "" && strings.EqualFold(apiKeyHeader, "Authorization") {
		apiKeyPrefix = "Bearer "
	}

	return &Client{
		endpointURL:  endpointURL,
		apiStyle:     style,
		apiKey:       apiKey,
		apiKeyHeader: apiKeyHeader,
		apiKeyPrefix: apiKeyPrefix,
		model:        model,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		maxInputChars:   maxInputChars,
		maxOutputTokens: maxOutputTokens,
	}
}

func (c *Client) Summarize(ctx context.Context, title string, content string) (Result, error) {
	return c.SummarizeWithModel(ctx, title, content, "")
}

func (c *Client) SummarizeWithModel(ctx context.Context, title string, content string, modelOverride string) (Result, error) {
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
	model := c.pickModel(modelOverride)
	result, err := c.complete(ctx, defaultSummarySystemPrompt, prompt, len(input), truncated, model)
	if err == nil {
		return result, nil
	}
	if !shouldRetryForMaxTokens(err) {
		return Result{}, err
	}

	retryInput, retryTruncated := compactSummaryInput(input, truncated, c.maxInputChars)
	retryPrompt := buildCompactPrompt(strings.TrimSpace(title), retryInput)
	return c.complete(ctx, defaultSummarySystemPrompt, retryPrompt, len(retryInput), retryTruncated, model)
}

func (c *Client) Complete(ctx context.Context, systemPrompt string, userPrompt string) (Result, error) {
	return c.CompleteWithModel(ctx, systemPrompt, userPrompt, "")
}

func (c *Client) CompleteWithModel(ctx context.Context, systemPrompt string, userPrompt string, modelOverride string) (Result, error) {
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

	return c.complete(ctx, system, input, len(input), truncated, c.pickModel(modelOverride))
}

func (c *Client) complete(
	ctx context.Context,
	systemPrompt string,
	userPrompt string,
	inputChars int,
	truncated bool,
	model string,
) (Result, error) {
	payload := c.buildPayload(systemPrompt, userPrompt, model)

	body, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpointURL, bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(c.apiKeyHeader, c.apiKeyPrefix+c.apiKey)

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

	var parsed map[string]any
	if err := json.Unmarshal(rawRespBody, &parsed); err != nil {
		return Result{}, fmt.Errorf("parse ai response failed: %w", err)
	}
	summary := strings.TrimSpace(extractResponseText(parsed))
	stopReason := extractStopReason(parsed)
	if isOutputTruncatedStopReason(stopReason) {
		truncated = true
	}
	if summary == "" {
		if apiErr := extractAPIError(parsed); apiErr != "" {
			return Result{}, fmt.Errorf("ai api error: %s", apiErr)
		}
		stopReason = firstNonEmpty(stopReason, anyString(parsed["status"]))
		if stopReason != "" {
			return Result{}, fmt.Errorf("ai summary is empty (stop_reason=%s)", stopReason)
		}
		return Result{}, fmt.Errorf("ai summary is empty")
	}

	resultModel := strings.TrimSpace(anyString(parsed["model"]))
	if resultModel == "" {
		resultModel = model
	}

	return Result{
		Summary:      summary,
		Model:        resultModel,
		InputChars:   inputChars,
		Truncated:    truncated,
		StopReason:   stopReason,
		GeneratedAt:  time.Now().UTC(),
		ProviderName: "geminicli2api",
	}, nil
}

func (c *Client) buildPayload(systemPrompt string, userPrompt string, model string) map[string]any {
	if c.apiStyle == apiStyleMessages {
		combinedPrompt := strings.TrimSpace(systemPrompt)
		if combinedPrompt != "" {
			combinedPrompt += "\n\n"
		}
		combinedPrompt += strings.TrimSpace(userPrompt)
		return map[string]any{
			"model":      model,
			"max_tokens": c.maxOutputTokens,
			"messages": []map[string]string{
				{
					"role":    "user",
					"content": combinedPrompt,
				},
			},
		}
	}

	return map[string]any{
		"model": model,
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
		"temperature":           0.2,
		"max_tokens":            c.maxOutputTokens,
		"max_completion_tokens": c.maxOutputTokens,
	}
}

func (c *Client) pickModel(modelOverride string) string {
	model := strings.TrimSpace(modelOverride)
	if model == "" {
		return c.model
	}
	return model
}

func normalizeAPIStyle(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	switch value {
	case "", apiStyleAuto:
		return apiStyleAuto
	case apiStyleMessages, "anthropic_messages":
		return apiStyleMessages
	default:
		return apiStyleOpenAIChat
	}
}

func detectAPIStyle(baseURL string) string {
	lower := strings.ToLower(strings.TrimSpace(baseURL))
	if strings.HasSuffix(lower, "/messages") || strings.Contains(lower, "/v1/messages") {
		return apiStyleMessages
	}
	return apiStyleOpenAIChat
}

func normalizeEndpointURL(rawBaseURL string, style string) string {
	base := strings.TrimSpace(rawBaseURL)
	if base == "" {
		return ""
	}
	parsed, err := url.Parse(base)
	if err != nil || strings.TrimSpace(parsed.Hostname()) == "" {
		return ""
	}

	if style == apiStyleMessages {
		if strings.HasSuffix(strings.TrimSpace(parsed.Path), "/messages") {
			return strings.TrimSuffix(base, "/")
		}
		parsed.Path = strings.TrimSuffix(parsed.Path, "/") + "/messages"
		return strings.TrimSuffix(parsed.String(), "/")
	}

	if strings.HasSuffix(strings.TrimSpace(parsed.Path), "/chat/completions") {
		return strings.TrimSuffix(base, "/")
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/") + "/chat/completions"
	return strings.TrimSuffix(parsed.String(), "/")
}

func extractResponseText(payload map[string]any) string {
	if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
		first := mapValue(choices[0])
		if message := mapValue(first["message"]); len(message) > 0 {
			if text := anyText(message["content"]); text != "" {
				return text
			}
		}
		if text := anyText(first["text"]); text != "" {
			return text
		}
	}

	if output, ok := payload["output"].([]any); ok && len(output) > 0 {
		for _, item := range output {
			itemMap := mapValue(item)
			if len(itemMap) == 0 {
				if text := anyText(item); text != "" {
					return text
				}
				continue
			}
			if text := anyText(itemMap["content"]); text != "" {
				return text
			}
			if text := anyText(itemMap["text"]); text != "" {
				return text
			}
		}
	}

	if message := mapValue(payload["message"]); len(message) > 0 {
		if text := anyText(message["content"]); text != "" {
			return text
		}
		if text := anyText(message["text"]); text != "" {
			return text
		}
	}

	if text := anyText(payload["content"]); text != "" {
		return text
	}
	if text := anyText(payload["output_text"]); text != "" {
		return text
	}
	if text := anyText(payload["text"]); text != "" {
		return text
	}

	if data := mapValue(payload["data"]); len(data) > 0 {
		if text := extractResponseText(data); text != "" {
			return text
		}
	}

	return ""
}

func extractAPIError(payload map[string]any) string {
	if errorText := strings.TrimSpace(anyString(payload["error"])); errorText != "" {
		return errorText
	}
	if errorObj := mapValue(payload["error"]); len(errorObj) > 0 {
		if message := strings.TrimSpace(anyString(errorObj["message"])); message != "" {
			return message
		}
		if detail := strings.TrimSpace(anyString(errorObj["detail"])); detail != "" {
			return detail
		}
	}
	if detail := strings.TrimSpace(anyString(payload["detail"])); detail != "" {
		return detail
	}
	if message := strings.TrimSpace(anyString(payload["message"])); message != "" {
		return message
	}
	if data := mapValue(payload["data"]); len(data) > 0 {
		if nested := extractAPIError(data); nested != "" {
			return nested
		}
	}
	return ""
}

func extractStopReason(payload map[string]any) string {
	if reason := firstNonEmpty(
		anyString(payload["stop_reason"]),
		anyString(payload["finish_reason"]),
	); reason != "" {
		return reason
	}

	if choices, ok := payload["choices"].([]any); ok && len(choices) > 0 {
		first := mapValue(choices[0])
		if reason := firstNonEmpty(
			anyString(first["finish_reason"]),
			anyString(first["stop_reason"]),
		); reason != "" {
			return reason
		}
	}

	if output, ok := payload["output"].([]any); ok && len(output) > 0 {
		for _, item := range output {
			itemMap := mapValue(item)
			if len(itemMap) == 0 {
				continue
			}
			if reason := firstNonEmpty(
				anyString(itemMap["finish_reason"]),
				anyString(itemMap["stop_reason"]),
			); reason != "" {
				return reason
			}
		}
	}

	if message := mapValue(payload["message"]); len(message) > 0 {
		if reason := firstNonEmpty(
			anyString(message["finish_reason"]),
			anyString(message["stop_reason"]),
		); reason != "" {
			return reason
		}
	}

	return ""
}

func anyText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := anyText(item); text != "" {
				parts = append(parts, text)
				continue
			}
			itemMap := mapValue(item)
			if len(itemMap) == 0 {
				continue
			}
			if text := strings.TrimSpace(anyString(itemMap["text"])); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	case map[string]any:
		if text := strings.TrimSpace(anyString(typed["text"])); text != "" {
			return text
		}
		if text := anyText(typed["content"]); text != "" {
			return text
		}
	}
	return ""
}

func mapValue(value any) map[string]any {
	mapped, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return mapped
}

func anyString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
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

func isOutputTruncatedStopReason(reason string) bool {
	normalized := strings.TrimSpace(strings.ToLower(reason))
	return normalized == "max_tokens" || normalized == "length" || normalized == "max_output_tokens"
}

func shouldRetryForMaxTokens(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(msg, "stop_reason=max_tokens")
}

func compactSummaryInput(input string, truncated bool, configuredMax int) (string, bool) {
	limit := configuredMax / 2
	if limit <= 0 {
		limit = 4000
	}
	if limit > 4000 {
		limit = 4000
	}
	if len(input) <= limit {
		return input, truncated
	}
	return input[:limit], true
}

func buildPrompt(title string, content string) string {
	var builder strings.Builder
	if title != "" {
		builder.WriteString("标题：")
		builder.WriteString(title)
		builder.WriteString("\n\n")
	}
	builder.WriteString("请对下面长文进行“中等长度的详细总结”，输出格式严格为：\n")
	builder.WriteString("1) TL;DR（3-4句，覆盖背景、核心结论与影响）\n")
	builder.WriteString("2) 核心观点与依据（4-6条；每条包含“观点：”和“依据：”）\n")
	builder.WriteString("3) 关键事实/数据（2-4条；没有就写“原文未明确给出”）\n")
	builder.WriteString("4) 争议、风险或局限（2-4条）\n")
	builder.WriteString("5) 对读者有用的启发/建议（0-3条；如果原文不适合给建议，就写“本篇以信息/观点为主，无直接可执行建议”）\n")
	builder.WriteString("6) 一句话结论\n\n")
	builder.WriteString("要求：\n")
	builder.WriteString("- 忠于原文，不编造事实；不确定信息请明确标注“原文未说明”。\n")
	builder.WriteString("- 除非原文极短，整体长度控制在320-580字。\n")
	builder.WriteString("- 每条尽量精炼，避免长段落；优先保留真正新增的信息密度，而不是把背景反复铺开。\n")
	builder.WriteString("- 如果内容明显更像论坛讨论或博客观点，请保留“谁在主张什么、依据是什么、哪里有争议”。\n\n")
	builder.WriteString("正文：\n")
	builder.WriteString(content)
	return builder.String()
}

func buildCompactPrompt(title string, content string) string {
	var builder strings.Builder
	if title != "" {
		builder.WriteString("标题：")
		builder.WriteString(title)
		builder.WriteString("\n\n")
	}
	builder.WriteString("请输出紧凑摘要，格式严格为：\n")
	builder.WriteString("1) 三句话总结\n")
	builder.WriteString("2) 关键信息（最多3条，优先事实、结论、变化）\n")
	builder.WriteString("3) 为什么值得关注（1条；如果不明显，就写“主要价值在于补充背景信息”）\n\n")
	builder.WriteString("要求：忠于原文，不编造；不要机械凑结构；总字数控制在160-280字。\n\n")
	builder.WriteString("正文：\n")
	builder.WriteString(content)
	return builder.String()
}
