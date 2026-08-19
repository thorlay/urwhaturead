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
	thinkingModeAuto       = "auto"
	thinkingModeEnabled    = "enabled"
	thinkingModeDisabled   = "disabled"
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
	ThinkingMode    string
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
	thinkingMode    string
}

func (c *Client) DefaultModel() string {
	if c == nil {
		return ""
	}
	return strings.TrimSpace(c.model)
}

func (c *Client) Probe(ctx context.Context) error {
	if c == nil {
		return ErrNotConfigured
	}

	payload := c.buildPayload("Reply with OK.", "ping", c.model)
	payload["max_tokens"] = 16
	if !isDeepSeekModel(c.model) {
		payload["max_completion_tokens"] = 16
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpointURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(c.apiKeyHeader, c.apiKeyPrefix+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request ai probe failed: %w", err)
	}
	defer resp.Body.Close()

	rawRespBody, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return fmt.Errorf("read ai probe response failed: %w", err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("ai probe status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(rawRespBody)))
	}
	return nil
}

const defaultSummarySystemPrompt = "你是一个中文阅读判断助手。你的任务不是把所有内容都写成新闻摘要，而是先识别内容类型，再提炼对读者有用的信息。输出中文，优先保留事实、证据、论点、讨论分歧、限制和可执行信息；避免空话、套话、模板化过渡句和无根据延伸。不确定的信息明确写“原文未说明”。"

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
	if strings.EqualFold(apiKeyHeader, "Authorization") {
		switch strings.ToLower(strings.TrimSpace(apiKeyPrefix)) {
		case "", "bearer":
			apiKeyPrefix = "Bearer "
		}
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
		thinkingMode:    normalizeThinkingMode(options.ThinkingMode),
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
		ProviderName: providerName(c.endpointURL, model),
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

	payload := map[string]any{
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
		"temperature": 0.2,
		"max_tokens":  c.maxOutputTokens,
	}
	if isDeepSeekModel(model) {
		payload["thinking"] = map[string]string{"type": c.deepSeekThinkingMode()}
	} else {
		payload["max_completion_tokens"] = c.maxOutputTokens
	}
	return payload
}

func (c *Client) deepSeekThinkingMode() string {
	if c.thinkingMode == thinkingModeEnabled {
		return thinkingModeEnabled
	}
	return thinkingModeDisabled
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

func normalizeThinkingMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case thinkingModeEnabled:
		return thinkingModeEnabled
	case thinkingModeDisabled:
		return thinkingModeDisabled
	default:
		return thinkingModeAuto
	}
}

func isDeepSeekModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "deepseek-")
}

func providerName(endpointURL string, model string) string {
	if isDeepSeekModel(model) || strings.Contains(strings.ToLower(endpointURL), "deepseek.com") {
		return "deepseek"
	}
	return "geminicli2api"
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
	builder.WriteString("请对下面内容进行“中等长度的阅读判断总结”。不要默认把它当新闻，先判断内容类型，再按对应重点总结。输出格式严格为：\n")
	builder.WriteString("1) 内容类型（从 news_event / essay_argument / forum_discussion / resource_tool / mixed 中选一个，并用一句话说明判断依据）\n")
	builder.WriteString("2) TL;DR（3-5句；根据类型覆盖事件变化、核心论点、讨论焦点或工具用途）\n")
	builder.WriteString("3) 重点拆解（4-7条；每条包含“要点：”和“依据/原因：”）\n")
	builder.WriteString("4) 类型化分析\n")
	builder.WriteString("   - 如果是 news_event：写背景、影响、后续关注点。\n")
	builder.WriteString("   - 如果是 essay_argument：写作者论点、论证链条、证据质量、可能漏洞。\n")
	builder.WriteString("   - 如果是 forum_discussion：写主要观点阵营、共识、分歧、有价值经验。\n")
	builder.WriteString("   - 如果是 resource_tool：写用途、适合谁、亮点、限制。\n")
	builder.WriteString("   - 如果是 mixed：按类型分组，不要强行合并成新闻。\n")
	builder.WriteString("5) 争议、风险或局限（2-4条；没有就写“原文未明确给出”）\n")
	builder.WriteString("6) 是否值得读（说明适合什么读者，以及是否需要打开原文）\n")
	builder.WriteString("7) 一句话结论\n\n")
	builder.WriteString("要求：\n")
	builder.WriteString("- 忠于原文，不编造事实；不确定信息请明确标注“原文未说明”。\n")
	builder.WriteString("- 除非原文极短，整体长度控制在450-800字；宁可信息密度高，也不要流水账。\n")
	builder.WriteString("- 每条尽量精炼，避免长段落；优先保留真正有判断价值的信息，而不是把背景反复铺开。\n")
	builder.WriteString("- 如果是观点文/长文，不要只写发生了什么，要写论点和论证是否站得住。\n")
	builder.WriteString("- 如果是论坛/评论，不要写成单一结论，要保留分歧、经验和上下文。\n\n")
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
	builder.WriteString("请输出紧凑摘要。不要默认按新闻写，先识别内容类型。格式严格为：\n")
	builder.WriteString("1) 内容类型（一句话）\n")
	builder.WriteString("2) 三句话总结（按新闻/观点文/论坛/工具资源的真实类型总结）\n")
	builder.WriteString("3) 关键信息（最多4条，优先事实、论点、证据、分歧或限制）\n")
	builder.WriteString("4) 为什么值得关注（1条；如果不明显，就写“主要价值在于补充背景信息”）\n\n")
	builder.WriteString("要求：忠于原文，不编造；不要机械凑结构；总字数控制在220-360字。\n\n")
	builder.WriteString("正文：\n")
	builder.WriteString(content)
	return builder.String()
}
