package handlers

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"quick/internal/aisummary"
	"quick/internal/feedextract"
	"quick/internal/models"
	"quick/internal/textclean"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type FeedHandler struct {
	db         *gorm.DB
	summarizer *aisummary.Client
}

func NewFeedHandler(db *gorm.DB, summarizer *aisummary.Client) *FeedHandler {
	return &FeedHandler{
		db:         db,
		summarizer: summarizer,
	}
}

func (h *FeedHandler) RegisterRoutes(group *gin.RouterGroup) {
	h.RegisterReadRoutes(group)
	h.RegisterWriteRoutes(group)
}

func (h *FeedHandler) RegisterReadRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
}

func (h *FeedHandler) RegisterWriteRoutes(group *gin.RouterGroup) {
	group.POST("/briefing", h.Briefing)
}

type feedItem struct {
	ID             uint64         `json:"id"`
	SourceID       uint64         `json:"source_id"`
	ClusterID      *uint64        `json:"cluster_id,omitempty"`
	SourceName     string         `json:"source_name"`
	SourceTag      string         `json:"source_tag"`
	Title          string         `json:"title"`
	Link           string         `json:"link"`
	Summary        *string        `json:"summary,omitempty"`
	Content        *string        `json:"content,omitempty"`
	Author         *string        `json:"author,omitempty"`
	PublishedAt    *time.Time     `json:"published_at,omitempty"`
	ImageURL       *string        `json:"image_url,omitempty"`
	ReplyCount     *int           `json:"reply_count,omitempty"`
	DuplicateCount int            `json:"duplicate_count"`
	CreatedAt      time.Time      `json:"created_at"`
	SortTime       time.Time      `json:"-"`
	Raw            datatypes.JSON `json:"-" gorm:"column:raw"`
}

type feedCursor struct {
	SortTime time.Time
	ID       uint64
}

type feedBriefingRequest struct {
	Limit      *int     `json:"limit"`
	Tag        string   `json:"tag"`
	Keyword    string   `json:"keyword"`
	Model      string   `json:"model"`
	SourceIDs  []uint64 `json:"source_ids"`
	ArticleIDs []uint64 `json:"article_ids"`
	Refresh    bool     `json:"refresh"`
	CacheOnly  bool     `json:"cache_only"`
}

type feedBriefingPayload struct {
	DigestKey    string                  `json:"digest_key"`
	Summary      string                  `json:"summary"`
	Model        string                  `json:"model"`
	Provider     string                  `json:"provider"`
	InputChars   int                     `json:"input_chars"`
	Truncated    bool                    `json:"truncated"`
	GeneratedAt  time.Time               `json:"generated_at"`
	CacheHit     bool                    `json:"cache_hit"`
	ArticleCount int                     `json:"article_count"`
	InputItems   []feedBriefingInputItem `json:"input_items"`
}

type feedBriefingInputItem struct {
	ID          uint64     `json:"id"`
	SourceID    uint64     `json:"source_id"`
	SourceName  string     `json:"source_name"`
	Title       string     `json:"title"`
	Link        string     `json:"link"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
}

const (
	defaultBriefingLimit  = 20
	maxBriefingLimit      = 50
	maxBriefingInputItems = 12
)

func (h *FeedHandler) List(c *gin.Context) {
	limit := 20
	if limitRaw := c.Query("limit"); limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 || value > 100 {
			badRequest(c, "limit must be an integer between 1 and 100")
			return
		}
		limit = value
	}

	dedupe := true
	if dedupeRaw := strings.TrimSpace(c.Query("dedupe")); dedupeRaw != "" {
		dedupe = parseBoolQuery(dedupeRaw)
	}
	includeHidden := parseBoolQuery(strings.TrimSpace(c.Query("include_hidden")))

	query := h.db.
		Table("articles AS a").
		Select(`
			a.id,
			a.source_id,
			a.cluster_id,
			s.name AS source_name,
			COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
			a.title,
			a.link,
			a.summary,
			a.content,
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
			a.raw,
			1 AS duplicate_count,
			a.created_at,
			COALESCE(a.published_at, a.created_at) AS sort_time
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id")
	if !includeHidden {
		query = query.Where("s.hidden_in_sidebar = ? AND s.kind <> ?", false, "thread")
	}

	if tag := normalizeSourceTag(c.Query("tag")); tag != "" {
		query = query.Where("s.tags @> ?::text[]", models.StringArray{tag})
	}

	if sourceIDsRaw := strings.TrimSpace(c.Query("source_ids")); sourceIDsRaw != "" {
		sourceIDs, err := parseCSVUint64(sourceIDsRaw)
		if err != nil {
			badRequest(c, err.Error())
			return
		}
		query = query.Where("a.source_id IN ?", sourceIDs)
	}

	if keyword := strings.TrimSpace(c.Query("q")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where(
			"(a.title ILIKE ? OR a.summary ILIKE ? OR a.content ILIKE ?)",
			like, like, like,
		)
	}

	var rows []feedItem
	if dedupe {
		ranked := query.
			Select(`
				a.id,
				a.source_id,
				a.cluster_id,
				s.name AS source_name,
				COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
				a.title,
				a.link,
				a.summary,
				a.content,
				a.author,
				a.published_at,
				a.image_url,
				a.reply_count,
				a.raw,
				a.created_at,
				COALESCE(a.published_at, a.created_at) AS sort_time,
				COUNT(*) OVER (PARTITION BY COALESCE(a.cluster_id, a.id)) AS duplicate_count,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(a.cluster_id, a.id)
					ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
				) AS rn
			`)

		outer := h.db.Table("(?) AS ranked", ranked).
			Select(`
				ranked.id,
				ranked.source_id,
				ranked.cluster_id,
				ranked.source_name,
				ranked.source_tag,
				ranked.title,
				ranked.link,
				ranked.summary,
				ranked.content,
				ranked.author,
				ranked.published_at,
				ranked.image_url,
				ranked.reply_count,
				ranked.raw,
				ranked.duplicate_count,
				ranked.created_at,
				ranked.sort_time
			`).
			Where("ranked.rn = 1")

		if cursorRaw := strings.TrimSpace(c.Query("cursor")); cursorRaw != "" {
			cursor, err := decodeFeedCursor(cursorRaw)
			if err != nil {
				badRequest(c, "invalid cursor")
				return
			}
			outer = outer.Where("(ranked.sort_time, ranked.id) < (?, ?)", cursor.SortTime, cursor.ID)
		}

		if err := outer.
			Order("ranked.sort_time DESC").
			Order("ranked.id DESC").
			Limit(limit + 1).
			Scan(&rows).Error; err != nil {
			internalServerError(c, "query deduped feed failed", err)
			return
		}
	} else {
		if cursorRaw := strings.TrimSpace(c.Query("cursor")); cursorRaw != "" {
			cursor, err := decodeFeedCursor(cursorRaw)
			if err != nil {
				badRequest(c, "invalid cursor")
				return
			}
			query = query.Where(
				"(COALESCE(a.published_at, a.created_at), a.id) < (?, ?)",
				cursor.SortTime, cursor.ID,
			)
		}
		if err := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(limit + 1).
			Scan(&rows).Error; err != nil {
			internalServerError(c, "query feed failed", err)
			return
		}
	}

	nextCursor := ""
	if len(rows) > limit {
		last := rows[limit-1]
		nextCursor = encodeFeedCursor(feedCursor{
			SortTime: last.SortTime,
			ID:       last.ID,
		})
		rows = rows[:limit]
	}
	sanitizeFeedItems(rows)

	c.JSON(http.StatusOK, gin.H{
		"data": rows,
		"meta": gin.H{
			"limit":       limit,
			"count":       len(rows),
			"next_cursor": nextCursor,
		},
	})
}

func (h *FeedHandler) Briefing(c *gin.Context) {
	if h.summarizer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "ai summary is not configured",
		})
		return
	}

	var req feedBriefingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	limit := defaultBriefingLimit
	if req.Limit != nil {
		if *req.Limit <= 0 || *req.Limit > maxBriefingLimit {
			badRequest(c, fmt.Sprintf("limit must be an integer between 1 and %d", maxBriefingLimit))
			return
		}
		limit = *req.Limit
	}
	if req.CacheOnly && req.Refresh {
		badRequest(c, "cache_only and refresh cannot both be true")
		return
	}

	tag := normalizeSourceTag(req.Tag)
	keyword := strings.TrimSpace(req.Keyword)
	requestedModel := strings.TrimSpace(req.Model)

	rows, err := h.queryBriefingFeedRows(c.Request.Context(), limit, tag, keyword, req.SourceIDs, req.ArticleIDs)
	if err != nil {
		internalServerError(c, "query feed briefing data failed", err)
		return
	}
	if len(rows) == 0 {
		badRequest(c, "no feed items available for briefing")
		return
	}

	digestKey, articleIDs := buildFeedBriefingDigest(limit, tag, keyword, requestedModel, req.SourceIDs, rows)
	inputItems := buildFeedBriefingInputItems(rows, maxBriefingInputItems)

	if !req.Refresh {
		var cached models.FeedBriefing
		err := h.db.WithContext(c.Request.Context()).Where("digest_key = ?", digestKey).Take(&cached).Error
		if err == nil {
			c.JSON(http.StatusOK, gin.H{
				"data": feedBriefingPayload{
					DigestKey:    digestKey,
					Summary:      cached.Summary,
					Model:        cached.Model,
					Provider:     cached.Provider,
					InputChars:   cached.InputChars,
					Truncated:    cached.Truncated,
					GeneratedAt:  cached.GeneratedAt,
					CacheHit:     true,
					ArticleCount: len(rows),
					InputItems:   inputItems,
				},
			})
			return
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			internalServerError(c, "query feed briefing cache failed", err)
			return
		}
		if req.CacheOnly {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "feed briefing cache not found",
			})
			return
		}
	}

	prompt := buildFeedBriefingPrompt(rows)
	result, err := h.summarizer.CompleteWithModel(
		c.Request.Context(),
		"你是一个新闻编辑台 AI，输出中文，每段都要有信息密度和可执行性。",
		prompt,
		requestedModel,
	)
	if err != nil {
		badGateway(c, err.Error())
		return
	}

	uniqueSourceIDs := uniqueSortedUint64(req.SourceIDs)
	record := models.FeedBriefing{
		DigestKey:   digestKey,
		Tag:         tag,
		Keyword:     keyword,
		SourceIDs:   joinUint64(uniqueSourceIDs),
		ArticleIDs:  joinUint64(articleIDs),
		Limit:       limit,
		Summary:     result.Summary,
		Model:       result.Model,
		Provider:    result.ProviderName,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		GeneratedAt: result.GeneratedAt,
	}
	if err := h.db.WithContext(c.Request.Context()).
		Where("digest_key = ?", digestKey).
		Assign(record).
		FirstOrCreate(&record).Error; err != nil {
		internalServerError(c, "save feed briefing cache failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": feedBriefingPayload{
			DigestKey:    digestKey,
			Summary:      result.Summary,
			Model:        result.Model,
			Provider:     result.ProviderName,
			InputChars:   result.InputChars,
			Truncated:    result.Truncated,
			GeneratedAt:  result.GeneratedAt,
			CacheHit:     false,
			ArticleCount: len(rows),
			InputItems:   inputItems,
		},
	})
}

func (h *FeedHandler) queryBriefingFeedRows(
	ctx context.Context,
	limit int,
	tag string,
	keyword string,
	sourceIDs []uint64,
	articleIDs []uint64,
) ([]feedItem, error) {
	query := h.db.WithContext(ctx).
		Table("articles AS a").
		Select(`
			a.id,
			a.source_id,
			s.name AS source_name,
			COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
			a.title,
			a.link,
			a.summary,
			a.content,
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
			a.raw,
			a.created_at,
			COALESCE(a.published_at, a.created_at) AS sort_time
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id")
	if len(sourceIDs) == 0 && len(articleIDs) == 0 {
		query = query.Where("s.hidden_in_sidebar = ? AND s.kind <> ?", false, "thread")
	}

	if len(articleIDs) > 0 {
		query = query.Where("a.id IN ?", uniqueSortedUint64(articleIDs))
	}
	if tag != "" {
		query = query.Where("s.tags @> ?::text[]", models.StringArray{tag})
	}
	if len(sourceIDs) > 0 {
		query = query.Where("a.source_id IN ?", uniqueSortedUint64(sourceIDs))
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(a.title ILIKE ? OR a.summary ILIKE ? OR a.content ILIKE ?)", like, like, like)
	}

	var rows []feedItem
	if err := query.
		Order("COALESCE(a.published_at, a.created_at) DESC").
		Order("a.id DESC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func buildFeedBriefingDigest(
	limit int,
	tag string,
	keyword string,
	model string,
	sourceIDs []uint64,
	rows []feedItem,
) (string, []uint64) {
	articleIDs := make([]uint64, 0, len(rows))
	for _, row := range rows {
		articleIDs = append(articleIDs, row.ID)
	}
	uniqueSources := uniqueSortedUint64(sourceIDs)
	payload := strings.Join([]string{
		"v1",
		fmt.Sprintf("limit=%d", limit),
		"tag=" + strings.TrimSpace(tag),
		"keyword=" + strings.TrimSpace(keyword),
		"model=" + strings.TrimSpace(model),
		"source_ids=" + joinUint64(uniqueSources),
		"article_ids=" + joinUint64(articleIDs),
	}, "|")
	sum := sha1.Sum([]byte(payload))
	return hex.EncodeToString(sum[:]), articleIDs
}

func buildFeedBriefingPrompt(items []feedItem) string {
	var builder strings.Builder
	builder.WriteString("请基于以下新闻列表输出「今日聚合速览」。\n")
	builder.WriteString("输出格式严格为：\n")
	builder.WriteString("1) 60秒全局概览（4-6条）\n")
	builder.WriteString("2) 重点主题分组（2-4组，每组2-4条）\n")
	builder.WriteString("3) 风险/争议观察（最多4条）\n")
	builder.WriteString("4) 值得深读（最多6条，格式：标题｜链接URL｜一句理由）\n\n")
	builder.WriteString("要求：\n")
	builder.WriteString("- 第4部分每一条都必须包含可访问的原始链接 URL。\n")
	builder.WriteString("- 链接必须来自下面提供的新闻条目，不要编造新链接。\n\n")
	builder.WriteString("新闻条目：\n")
	for i, item := range items {
		builder.WriteString(fmt.Sprintf(
			"%d. [%s/%s] %s\n",
			i+1,
			textclean.NormalizeInline(item.SourceName),
			textclean.NormalizeInline(item.SourceTag),
			textclean.NormalizeInline(item.Title),
		))
		builder.WriteString("   摘要: ")
		builder.WriteString(briefingSnippet(item))
		builder.WriteString("\n")
		builder.WriteString("   链接: ")
		builder.WriteString(strings.TrimSpace(item.Link))
		builder.WriteString("\n")
	}
	return builder.String()
}

func briefingSnippet(item feedItem) string {
	raw := ""
	if item.Summary != nil {
		raw = *item.Summary
	}
	text := textclean.NormalizeFromHTML(raw)
	if text == "" {
		return "无摘要"
	}
	if len(text) > 220 {
		return text[:220] + "..."
	}
	return text
}

func buildFeedBriefingInputItems(rows []feedItem, maxItems int) []feedBriefingInputItem {
	if len(rows) == 0 || maxItems <= 0 {
		return nil
	}
	if maxItems > len(rows) {
		maxItems = len(rows)
	}

	items := make([]feedBriefingInputItem, 0, maxItems)
	for index := 0; index < maxItems; index += 1 {
		row := rows[index]
		title := textclean.NormalizeInline(row.Title)
		if title == "" {
			title = fmt.Sprintf("文章 #%d", row.ID)
		}
		items = append(items, feedBriefingInputItem{
			ID:          row.ID,
			SourceID:    row.SourceID,
			SourceName:  textclean.NormalizeInline(row.SourceName),
			Title:       title,
			Link:        strings.TrimSpace(row.Link),
			PublishedAt: row.PublishedAt,
		})
	}
	return items
}

func sanitizeFeedItems(items []feedItem) {
	for i := range items {
		item := &items[i]
		item.SourceName = textclean.NormalizeInline(item.SourceName)
		item.SourceTag = textclean.NormalizeInline(item.SourceTag)
		item.Title = textclean.NormalizeInline(item.Title)
		if item.Summary != nil {
			value := textclean.NormalizeFromHTML(*item.Summary)
			if value == "" {
				item.Summary = nil
			} else {
				item.Summary = &value
			}
		}
		if item.Content != nil {
			value := textclean.NormalizeFromHTML(*item.Content)
			if value == "" {
				item.Content = nil
			} else {
				const maxContentPreviewChars = 320
				if len(value) > maxContentPreviewChars {
					value = value[:maxContentPreviewChars] + "..."
				}
				item.Content = &value
			}
		}
		if item.Author != nil {
			value := textclean.NormalizeInline(*item.Author)
			if value == "" {
				item.Author = nil
			} else {
				item.Author = &value
			}
		}
		if item.ImageURL == nil {
			if fallback := feedextract.ImageFromRaw(item.Raw, item.Link); fallback != "" {
				item.ImageURL = &fallback
			}
		}
		if item.ReplyCount == nil {
			item.ReplyCount = feedextract.ReplyCountFromRaw(item.Raw)
		}
	}
}

func uniqueSortedUint64(input []uint64) []uint64 {
	if len(input) == 0 {
		return nil
	}
	seen := map[uint64]struct{}{}
	output := make([]uint64, 0, len(input))
	for _, value := range input {
		if value == 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		output = append(output, value)
	}
	sort.Slice(output, func(i, j int) bool { return output[i] < output[j] })
	return output
}

func joinUint64(values []uint64) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.FormatUint(value, 10))
	}
	return strings.Join(parts, ",")
}

func parseCSVUint64(raw string) ([]uint64, error) {
	parts := strings.Split(raw, ",")
	result := make([]uint64, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		id, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("source_ids must be comma-separated unsigned integers")
		}
		result = append(result, id)
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("source_ids must contain at least one id")
	}
	return result, nil
}

func encodeFeedCursor(cursor feedCursor) string {
	payload := fmt.Sprintf("%d:%d", cursor.SortTime.UTC().UnixNano(), cursor.ID)
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

func decodeFeedCursor(raw string) (feedCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return feedCursor{}, err
	}

	parts := strings.Split(string(decoded), ":")
	if len(parts) != 2 {
		return feedCursor{}, fmt.Errorf("invalid format")
	}

	unixNano, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return feedCursor{}, err
	}
	id, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return feedCursor{}, err
	}

	return feedCursor{
		SortTime: time.Unix(0, unixNano).UTC(),
		ID:       id,
	}, nil
}
