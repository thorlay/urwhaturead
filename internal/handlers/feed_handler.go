package handlers

import (
	"context"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"quick/internal/aisummary"
	"quick/internal/articlesummary"
	"quick/internal/feedextract"
	"quick/internal/models"
	"quick/internal/textclean"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type FeedHandler struct {
	db               *gorm.DB
	summarizer       *aisummary.Client
	adminAuthEnabled bool
	adminToken       string
	briefingLimiter  *briefingRateLimiter
	briefingCooldown *briefingCooldownStore
	briefingTasks    *feedBriefingTaskService
}

const (
	feedBriefingPromptVersion = "v3"
	feedBriefingSystemPrompt  = "你是一个中文个人信息判断助手。输出要好读，也要保留足够的信息和推理。不要把所有条目都当新闻；先识别内容更像新闻事件、长文论点、论坛讨论、工具资源还是混合内容，再按价值提炼。对多源报道先提炼共同事实，但必须保留各来源独有的新增信息、解读角度和分歧。按重要性输出，优先保留真正新增、多源确认、讨论升温、论点质量高、经验信息密度高或影响较大的内容。"
)

type FeedHandlerOptions struct {
	AdminAuthEnabled bool
	AdminToken       string
	RateLimitPerHour int
	CooldownSec      int
}

func NewFeedHandler(db *gorm.DB, summarizer *aisummary.Client, options FeedHandlerOptions) *FeedHandler {
	rateLimit := options.RateLimitPerHour
	if rateLimit <= 0 {
		rateLimit = 10
	}
	cooldown := time.Duration(options.CooldownSec) * time.Second
	if cooldown <= 0 {
		cooldown = 10 * time.Minute
	}

	handler := &FeedHandler{
		db:               db,
		summarizer:       summarizer,
		adminAuthEnabled: options.AdminAuthEnabled,
		adminToken:       strings.TrimSpace(options.AdminToken),
		briefingLimiter:  newBriefingRateLimiter(rateLimit, time.Hour),
		briefingCooldown: newBriefingCooldownStore(cooldown),
	}
	handler.briefingTasks = newFeedBriefingTaskService(db, handler.runFeedBriefingTask)
	return handler
}

func (h *FeedHandler) RegisterRoutes(group *gin.RouterGroup) {
	h.RegisterReadRoutes(group)
	h.RegisterWriteRoutes(group)
}

func (h *FeedHandler) RegisterReadRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.GET("/briefings", h.ListBriefings)
	group.GET("/briefing/status", h.BriefingStatus)
	group.GET("/briefing/result", h.BriefingResult)
	group.POST("/briefing", h.Briefing)
}

func (h *FeedHandler) RegisterWriteRoutes(group *gin.RouterGroup) {}

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
	ContentHash    string         `json:"-" gorm:"column:content_hash"`
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
	Async      bool     `json:"async"`
}

type feedBriefingPayload struct {
	DigestKey    string                  `json:"digest_key"`
	Summary      string                  `json:"summary"`
	Model        string                  `json:"model"`
	Provider     string                  `json:"provider"`
	InputChars   int                     `json:"input_chars"`
	Truncated    bool                    `json:"truncated"`
	StopReason   string                  `json:"stop_reason"`
	GeneratedAt  time.Time               `json:"generated_at"`
	CacheHit     bool                    `json:"cache_hit"`
	ArticleCount int                     `json:"article_count"`
	InputItems   []feedBriefingInputItem `json:"input_items"`
}

type feedBriefingListItem struct {
	DigestKey    string                  `json:"digest_key"`
	ScopeLabel   string                  `json:"scope_label"`
	Tag          string                  `json:"tag"`
	Keyword      string                  `json:"keyword"`
	SourceIDs    string                  `json:"source_ids"`
	ArticleIDs   string                  `json:"article_ids"`
	ArticleRefs  []feedBriefingInputItem `json:"article_refs"`
	Limit        int                     `json:"limit"`
	Summary      string                  `json:"summary"`
	Model        string                  `json:"model"`
	Provider     string                  `json:"provider"`
	InputChars   int                     `json:"input_chars"`
	Truncated    bool                    `json:"truncated"`
	StopReason   string                  `json:"stop_reason"`
	GeneratedAt  time.Time               `json:"generated_at"`
	ArticleCount int                     `json:"article_count"`
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

func (h *FeedHandler) ListBriefings(c *gin.Context) {
	limit, offset, err := parseListWindow(c, 20, 100)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	query := h.db.WithContext(c.Request.Context()).
		Model(&models.FeedBriefing{})

	if keyword := strings.TrimSpace(c.Query("q")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(summary ILIKE ? OR tag ILIKE ? OR keyword ILIKE ?)", like, like, like)
	}

	var rows []models.FeedBriefing
	if err := query.
		Order("generated_at DESC").
		Order("id DESC").
		Limit(limit).
		Offset(offset).
		Find(&rows).Error; err != nil {
		internalServerError(c, "query feed briefings failed", err)
		return
	}

	sourceNameByID, err := h.loadSourceNamesForBriefings(c.Request.Context(), rows)
	if err != nil {
		internalServerError(c, "query feed briefing source names failed", err)
		return
	}
	articleRefsByDigest, err := h.loadArticleRefsForBriefings(c.Request.Context(), rows, sourceNameByID)
	if err != nil {
		internalServerError(c, "query feed briefing article refs failed", err)
		return
	}

	items := make([]feedBriefingListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, feedBriefingListItem{
			DigestKey:    row.DigestKey,
			ScopeLabel:   buildFeedBriefingScopeLabel(row.Tag, row.Keyword, row.SourceIDs, sourceNameByID),
			Tag:          row.Tag,
			Keyword:      row.Keyword,
			SourceIDs:    row.SourceIDs,
			ArticleIDs:   row.ArticleIDs,
			ArticleRefs:  articleRefsByDigest[row.DigestKey],
			Limit:        row.Limit,
			Summary:      row.Summary,
			Model:        row.Model,
			Provider:     row.Provider,
			InputChars:   row.InputChars,
			Truncated:    row.Truncated,
			StopReason:   row.StopReason,
			GeneratedAt:  row.GeneratedAt,
			ArticleCount: countCSVEntries(row.ArticleIDs),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data": items,
		"meta": gin.H{
			"limit":  limit,
			"offset": offset,
			"count":  len(items),
		},
	})
}

func (h *FeedHandler) List(c *gin.Context) {
	startedAt := time.Now()
	limit := 20
	if limitRaw := c.Query("limit"); limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 || value > 100 {
			badRequest(c, "limit must be an integer between 1 and 100")
			return
		}
		limit = value
	}

	dedupe := parseFeedDedupeQuery(c.Query("dedupe"))
	includeHidden := parseBoolQuery(strings.TrimSpace(c.Query("include_hidden")))
	since, err := parseFeedSince(c.Query("since"))
	if err != nil {
		badRequest(c, err.Error())
		return
	}

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
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
			COALESCE(ec.article_count, 1) AS duplicate_count,
			a.created_at,
			COALESCE(a.published_at, a.created_at) AS sort_time
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id").
		Joins("LEFT JOIN event_clusters AS ec ON ec.id = a.cluster_id")
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
	if since != nil {
		query = query.Where("a.created_at > ?", *since)
	}

	var totalCount int64
	if since != nil {
		if err := query.Session(&gorm.Session{}).
			Select("COUNT(DISTINCT a.id)").
			Scan(&totalCount).Error; err != nil {
			internalServerError(c, "count feed items since checkpoint failed", err)
			return
		}
	}

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

	var rows []feedItem
	queryStartedAt := time.Now()
	dedupeCandidateLimit := 0
	if dedupe {
		dedupeCandidateLimit = feedDedupeCandidateLimit(limit)
		candidates := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(dedupeCandidateLimit)

		ranked := h.db.Table("(?) AS candidates", candidates).
			Select(`
				candidates.id,
				candidates.source_id,
				candidates.cluster_id,
				candidates.source_name,
				candidates.source_tag,
				candidates.title,
				candidates.link,
				candidates.summary,
				candidates.author,
				candidates.published_at,
				candidates.image_url,
				candidates.reply_count,
				candidates.created_at,
				candidates.sort_time,
				MAX(candidates.duplicate_count) OVER (PARTITION BY COALESCE(candidates.cluster_id, candidates.id)) AS duplicate_count,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(candidates.cluster_id, candidates.id)
					ORDER BY candidates.sort_time DESC, candidates.id DESC
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
				ranked.author,
				ranked.published_at,
				ranked.image_url,
				ranked.reply_count,
				ranked.duplicate_count,
				ranked.created_at,
				ranked.sort_time
			`).
			Where("ranked.rn = 1")

		if err := outer.
			Order("ranked.sort_time DESC").
			Order("ranked.id DESC").
			Limit(limit + 1).
			Scan(&rows).Error; err != nil {
			internalServerError(c, "query deduped feed failed", err)
			return
		}
	} else {
		if err := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(limit + 1).
			Scan(&rows).Error; err != nil {
			internalServerError(c, "query feed failed", err)
			return
		}
	}
	queryElapsed := time.Since(queryStartedAt)

	nextCursor := ""
	if len(rows) > limit {
		last := rows[limit-1]
		nextCursor = encodeFeedCursor(feedCursor{
			SortTime: last.SortTime,
			ID:       last.ID,
		})
		rows = rows[:limit]
	}
	sanitizeStartedAt := time.Now()
	sanitizeFeedItems(rows)
	sanitizeElapsed := time.Since(sanitizeStartedAt)
	totalElapsed := time.Since(startedAt)

	meta := gin.H{
		"limit":                  limit,
		"count":                  len(rows),
		"next_cursor":            nextCursor,
		"elapsed_ms":             totalElapsed.Milliseconds(),
		"query_ms":               queryElapsed.Milliseconds(),
		"sanitize_ms":            sanitizeElapsed.Milliseconds(),
		"dedupe":                 dedupe,
		"dedupe_candidate_limit": dedupeCandidateLimit,
	}
	if since != nil {
		meta["since"] = since.Format(time.RFC3339)
		meta["total_count"] = totalCount
	}

	c.JSON(http.StatusOK, gin.H{"data": rows, "meta": meta})
}

func feedDedupeCandidateLimit(limit int) int {
	candidateLimit := limit * 15
	if candidateLimit < limit+80 {
		return limit + 80
	}
	if candidateLimit > 800 {
		return 800
	}
	return candidateLimit
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
	if req.CacheOnly && req.Async {
		badRequest(c, "cache_only and async cannot both be true")
		return
	}
	isAdmin := h.isAdminRequest(c)
	if req.Refresh && !isAdmin {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "admin authentication required",
		})
		return
	}

	tag := normalizeSourceTag(req.Tag)
	keyword := normalizeBriefingKeyword(req.Keyword)
	requestedModel := strings.TrimSpace(req.Model)
	effectiveModel := resolveFeedBriefingModel(requestedModel, h.summarizer, isAdmin)

	rows, err := h.queryBriefingFeedRows(c.Request.Context(), limit, tag, keyword, req.SourceIDs, req.ArticleIDs)
	if err != nil {
		internalServerError(c, "query feed briefing data failed", err)
		return
	}
	if len(rows) == 0 {
		badRequest(c, "no feed items available for briefing")
		return
	}
	promptRows := rows
	if len(promptRows) == 0 {
		badRequest(c, "no feed items available for briefing")
		return
	}

	digestKey, articleIDs := buildFeedBriefingDigest(limit, tag, keyword, effectiveModel, req.SourceIDs, promptRows)
	inputItems := buildFeedBriefingInputItems(promptRows, maxBriefingInputItems)

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
					StopReason:   cached.StopReason,
					GeneratedAt:  cached.GeneratedAt,
					CacheHit:     true,
					ArticleCount: len(promptRows),
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

	if !isAdmin {
		now := time.Now().UTC()
		if retryAfter, ok := h.briefingLimiter.Allow(h.requesterKey(c), now); !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":           "briefing rate limit exceeded",
				"retry_after_sec": int(math.Ceil(retryAfter.Seconds())),
			})
			return
		}
		if retryAfter, ok := h.briefingCooldown.Allow(digestKey, now); !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":           "briefing cooldown is active",
				"retry_after_sec": int(math.Ceil(retryAfter.Seconds())),
			})
			return
		}
	}

	taskInput := feedBriefingTaskInput{
		DigestKey:  digestKey,
		Limit:      limit,
		Tag:        tag,
		Keyword:    keyword,
		Model:      effectiveModel,
		SourceIDs:  uniqueSortedUint64(req.SourceIDs),
		ArticleIDs: articleIDs,
		Refresh:    req.Refresh,
	}
	if req.Async {
		state, err := h.briefingTasks.Enqueue(taskInput)
		if err != nil {
			internalServerError(c, "enqueue feed briefing failed", err)
			return
		}
		c.JSON(http.StatusAccepted, gin.H{"data": state})
		return
	}

	payload, err := h.generateAndSaveFeedBriefing(c.Request.Context(), taskInput, promptRows, inputItems)
	if err != nil {
		badGateway(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": payload})
}

func (h *FeedHandler) BriefingStatus(c *gin.Context) {
	digestKey, ok := parseFeedBriefingDigest(c)
	if !ok {
		return
	}
	state, err := h.briefingTasks.GetState(c.Request.Context(), digestKey)
	if err != nil {
		internalServerError(c, "query feed briefing task failed", err)
		return
	}
	if state.Status == articlesummary.StatusIdle {
		var cached models.FeedBriefing
		result := h.db.WithContext(c.Request.Context()).Where("digest_key = ?", digestKey).Limit(1).Find(&cached)
		if result.Error != nil {
			internalServerError(c, "query feed briefing cache failed", result.Error)
			return
		}
		if result.RowsAffected > 0 {
			state.Model = cached.Model
			state.Status = articlesummary.StatusSucceeded
			state.UpdatedAt = cached.GeneratedAt
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": state})
}

func (h *FeedHandler) BriefingResult(c *gin.Context) {
	digestKey, ok := parseFeedBriefingDigest(c)
	if !ok {
		return
	}
	var cached models.FeedBriefing
	result := h.db.WithContext(c.Request.Context()).Where("digest_key = ?", digestKey).Limit(1).Find(&cached)
	if result.Error != nil {
		internalServerError(c, "query feed briefing cache failed", result.Error)
		return
	}
	if result.RowsAffected == 0 {
		notFound(c, "feed briefing result not found")
		return
	}
	sourceNames, err := h.loadSourceNamesForBriefings(c.Request.Context(), []models.FeedBriefing{cached})
	if err != nil {
		internalServerError(c, "load feed briefing sources failed", err)
		return
	}
	articleRefs, err := h.loadArticleRefsForBriefings(c.Request.Context(), []models.FeedBriefing{cached}, sourceNames)
	if err != nil {
		internalServerError(c, "load feed briefing articles failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": feedBriefingPayload{
		DigestKey:    cached.DigestKey,
		Summary:      cached.Summary,
		Model:        cached.Model,
		Provider:     cached.Provider,
		InputChars:   cached.InputChars,
		Truncated:    cached.Truncated,
		StopReason:   cached.StopReason,
		GeneratedAt:  cached.GeneratedAt,
		CacheHit:     true,
		ArticleCount: countCSVEntries(cached.ArticleIDs),
		InputItems:   articleRefs[cached.DigestKey],
	}})
}

func parseFeedBriefingDigest(c *gin.Context) (string, bool) {
	digestKey := strings.TrimSpace(c.Query("digest_key"))
	if len(digestKey) != sha1.Size*2 {
		badRequest(c, "digest_key must be a SHA-1 hex digest")
		return "", false
	}
	if _, err := hex.DecodeString(digestKey); err != nil {
		badRequest(c, "digest_key must be a SHA-1 hex digest")
		return "", false
	}
	return strings.ToLower(digestKey), true
}

func (h *FeedHandler) runFeedBriefingTask(ctx context.Context, input feedBriefingTaskInput) error {
	rows, err := h.queryBriefingFeedRows(ctx, input.Limit, input.Tag, input.Keyword, input.SourceIDs, input.ArticleIDs)
	if err != nil {
		return fmt.Errorf("query feed briefing data: %w", err)
	}
	if len(rows) == 0 {
		return errors.New("no feed items available for briefing")
	}
	digestKey, _ := buildFeedBriefingDigest(input.Limit, input.Tag, input.Keyword, input.Model, input.SourceIDs, rows)
	if digestKey != input.DigestKey {
		return errors.New("feed briefing input changed before generation")
	}
	if !input.Refresh {
		var cached models.FeedBriefing
		result := h.db.WithContext(ctx).Where("digest_key = ?", input.DigestKey).Limit(1).Find(&cached)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			return nil
		}
	}
	_, err = h.generateAndSaveFeedBriefing(ctx, input, rows, nil)
	return err
}

func (h *FeedHandler) generateAndSaveFeedBriefing(
	ctx context.Context,
	input feedBriefingTaskInput,
	rows []feedItem,
	inputItems []feedBriefingInputItem,
) (feedBriefingPayload, error) {
	prompt := buildFeedBriefingPrompt(rows)
	result, err := h.summarizer.CompleteWithModel(ctx, feedBriefingSystemPrompt, prompt, input.Model)
	if err != nil {
		return feedBriefingPayload{}, err
	}

	record := models.FeedBriefing{
		DigestKey:   input.DigestKey,
		Tag:         input.Tag,
		Keyword:     input.Keyword,
		SourceIDs:   joinUint64(input.SourceIDs),
		ArticleIDs:  joinUint64(input.ArticleIDs),
		Limit:       input.Limit,
		Summary:     result.Summary,
		Model:       result.Model,
		Provider:    result.ProviderName,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		StopReason:  result.StopReason,
		GeneratedAt: result.GeneratedAt,
	}
	if err := h.db.WithContext(ctx).
		Where("digest_key = ?", input.DigestKey).
		Assign(record).
		FirstOrCreate(&record).Error; err != nil {
		return feedBriefingPayload{}, fmt.Errorf("save feed briefing cache: %w", err)
	}
	h.briefingCooldown.Touch(input.DigestKey, result.GeneratedAt)
	if inputItems == nil {
		inputItems = buildFeedBriefingInputItems(rows, maxBriefingInputItems)
	}
	return feedBriefingPayload{
		DigestKey:    input.DigestKey,
		Summary:      result.Summary,
		Model:        result.Model,
		Provider:     result.ProviderName,
		InputChars:   result.InputChars,
		Truncated:    result.Truncated,
		StopReason:   result.StopReason,
		GeneratedAt:  result.GeneratedAt,
		CacheHit:     false,
		ArticleCount: len(rows),
		InputItems:   inputItems,
	}, nil
}

func (h *FeedHandler) isAdminRequest(c *gin.Context) bool {
	if !h.adminAuthEnabled {
		return true
	}
	token := strings.TrimSpace(h.adminToken)
	if token == "" {
		return false
	}
	candidate := strings.TrimSpace(c.GetHeader("X-Admin-Token"))
	if candidate == "" {
		candidate = parseBearerTokenFromHeader(c.GetHeader("Authorization"))
	}
	if candidate == "" {
		candidate, _ = c.Cookie(adminCookieName)
		candidate = strings.TrimSpace(candidate)
	}
	if candidate == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(token)) == 1
}

func (h *FeedHandler) requesterKey(c *gin.Context) string {
	ip := strings.TrimSpace(c.ClientIP())
	if ip == "" {
		ip = "unknown"
	}
	session := strings.TrimSpace(c.GetHeader("X-Client-Session"))
	if session == "" {
		session, _ = c.Cookie("quick_client_id")
		session = strings.TrimSpace(session)
	}
	if session != "" {
		return ip + "|sid:" + session
	}
	ua := strings.TrimSpace(c.GetHeader("User-Agent"))
	if len(ua) > 120 {
		ua = ua[:120]
	}
	if ua != "" {
		return ip + "|ua:" + ua
	}
	return ip
}

type briefingRateLimiter struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	state  map[string]briefingRateState
}

type briefingRateState struct {
	resetAt time.Time
	count   int
}

func newBriefingRateLimiter(limit int, window time.Duration) *briefingRateLimiter {
	if limit <= 0 {
		limit = 10
	}
	if window <= 0 {
		window = time.Hour
	}
	return &briefingRateLimiter{
		limit:  limit,
		window: window,
		state:  make(map[string]briefingRateState),
	}
}

func (l *briefingRateLimiter) Allow(key string, now time.Time) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if strings.TrimSpace(key) == "" {
		key = "unknown"
	}
	current, exists := l.state[key]
	if !exists || now.After(current.resetAt) {
		l.state[key] = briefingRateState{
			resetAt: now.Add(l.window),
			count:   1,
		}
		return 0, true
	}
	if current.count >= l.limit {
		return current.resetAt.Sub(now), false
	}
	current.count++
	l.state[key] = current
	return 0, true
}

type briefingCooldownStore struct {
	cooldown time.Duration
	mu       sync.Mutex
	lastAt   map[string]time.Time
}

func newBriefingCooldownStore(cooldown time.Duration) *briefingCooldownStore {
	if cooldown <= 0 {
		cooldown = 10 * time.Minute
	}
	return &briefingCooldownStore{
		cooldown: cooldown,
		lastAt:   make(map[string]time.Time),
	}
}

func (s *briefingCooldownStore) Allow(key string, now time.Time) (time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(key) == "" {
		return 0, true
	}
	last, ok := s.lastAt[key]
	if !ok {
		return 0, true
	}
	next := last.Add(s.cooldown)
	if now.Before(next) {
		return next.Sub(now), false
	}
	return 0, true
}

func (s *briefingCooldownStore) Touch(key string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(key) == "" {
		return
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}
	s.lastAt[key] = at
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
			a.cluster_id,
			s.name AS source_name,
			COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
			a.title,
			a.link,
			a.summary,
			a.author,
			a.published_at,
			a.image_url,
			 a.reply_count,
			 a.content_hash,
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
		feedBriefingPromptVersion,
		fmt.Sprintf("limit=%d", limit),
		"tag=" + strings.TrimSpace(tag),
		"keyword=" + normalizeBriefingKeyword(keyword),
		"model=" + strings.TrimSpace(model),
		"source_ids=" + joinUint64(uniqueSources),
		"article_ids=" + joinUint64(articleIDs),
	}, "|")
	sum := sha1.Sum([]byte(payload))
	return hex.EncodeToString(sum[:]), articleIDs
}

func parseFeedDedupeQuery(raw string) bool {
	raw = strings.TrimSpace(raw)
	return raw != "" && parseBoolQuery(raw)
}

func parseFeedSince(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, errors.New("since must be an RFC3339 timestamp")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func resolveFeedBriefingModel(requestedModel string, summarizer *aisummary.Client, isAdmin bool) string {
	if !isAdmin {
		if summarizer == nil {
			return ""
		}
		return strings.TrimSpace(summarizer.DefaultModel())
	}
	model := strings.TrimSpace(requestedModel)
	if model != "" {
		return model
	}
	if summarizer == nil {
		return ""
	}
	return strings.TrimSpace(summarizer.DefaultModel())
}

func buildFeedBriefingScopeLabel(tag string, keyword string, sourceIDsCSV string, sourceNameByID map[uint64]string) string {
	tag = normalizeSourceTag(tag)
	keyword = normalizeBriefingKeyword(keyword)
	if tag != "" && keyword != "" {
		return tag + " · " + keyword
	}
	if keyword != "" {
		return "关键词 · " + keyword
	}
	if tag != "" {
		return "标签 · " + tag
	}
	if sourceIDs := parseCSVUint64Loose(sourceIDsCSV); len(sourceIDs) == 1 {
		if name := strings.TrimSpace(sourceNameByID[sourceIDs[0]]); name != "" {
			return name
		}
	}
	sourceCount := countCSVEntries(sourceIDsCSV)
	if sourceCount > 0 {
		return fmt.Sprintf("%d 个来源", sourceCount)
	}
	return "当前阅读流"
}

func (h *FeedHandler) loadSourceNamesForBriefings(ctx context.Context, rows []models.FeedBriefing) (map[uint64]string, error) {
	sourceIDs := make([]uint64, 0)
	for _, row := range rows {
		sourceIDs = append(sourceIDs, parseCSVUint64Loose(row.SourceIDs)...)
	}
	sourceIDs = uniqueSortedUint64(sourceIDs)
	if len(sourceIDs) == 0 {
		return map[uint64]string{}, nil
	}
	var sources []struct {
		ID   uint64
		Name string
	}
	if err := h.db.WithContext(ctx).Table("sources").Select("id, name").Where("id IN ?", sourceIDs).Scan(&sources).Error; err != nil {
		return nil, err
	}
	result := make(map[uint64]string, len(sources))
	for _, source := range sources {
		result[source.ID] = strings.TrimSpace(source.Name)
	}
	return result, nil
}

func (h *FeedHandler) loadArticleRefsForBriefings(
	ctx context.Context,
	rows []models.FeedBriefing,
	sourceNameByID map[uint64]string,
) (map[string][]feedBriefingInputItem, error) {
	articleIDs := make([]uint64, 0)
	for _, row := range rows {
		articleIDs = append(articleIDs, parseCSVUint64OrderedLoose(row.ArticleIDs)...)
	}
	articleIDs = uniqueSortedUint64(articleIDs)
	if len(articleIDs) == 0 {
		return map[string][]feedBriefingInputItem{}, nil
	}

	var articles []struct {
		ID          uint64
		SourceID    uint64
		Title       string
		Link        string
		PublishedAt *time.Time
	}
	if err := h.db.WithContext(ctx).
		Table("articles").
		Select("id, source_id, title, link, published_at").
		Where("id IN ?", articleIDs).
		Scan(&articles).Error; err != nil {
		return nil, err
	}

	articleByID := make(map[uint64]feedBriefingInputItem, len(articles))
	for _, article := range articles {
		title := textclean.NormalizeInline(article.Title)
		if title == "" {
			title = fmt.Sprintf("文章 #%d", article.ID)
		}
		articleByID[article.ID] = feedBriefingInputItem{
			ID:          article.ID,
			SourceID:    article.SourceID,
			SourceName:  textclean.NormalizeInline(sourceNameByID[article.SourceID]),
			Title:       title,
			Link:        strings.TrimSpace(article.Link),
			PublishedAt: article.PublishedAt,
		}
	}

	result := make(map[string][]feedBriefingInputItem, len(rows))
	for _, row := range rows {
		result[row.DigestKey] = orderFeedBriefingArticleRefs(row.ArticleIDs, articleByID)
	}
	return result, nil
}

func orderFeedBriefingArticleRefs(
	rawArticleIDs string,
	articleByID map[uint64]feedBriefingInputItem,
) []feedBriefingInputItem {
	ids := parseCSVUint64OrderedLoose(rawArticleIDs)
	refs := make([]feedBriefingInputItem, 0, len(ids))
	for _, articleID := range ids {
		if ref, ok := articleByID[articleID]; ok {
			refs = append(refs, ref)
		}
	}
	return refs
}

func normalizeBriefingKeyword(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func countCSVEntries(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	parts := strings.Split(raw, ",")
	count := 0
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			count++
		}
	}
	return count
}

func parseCSVUint64Loose(raw string) []uint64 {
	return uniqueSortedUint64(parseCSVUint64OrderedLoose(raw))
}

func parseCSVUint64OrderedLoose(raw string) []uint64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]uint64, 0, len(parts))
	seen := make(map[uint64]struct{}, len(parts))
	for _, part := range parts {
		value, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil || value == 0 {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func buildFeedBriefingPrompt(items []feedItem) string {
	var builder strings.Builder
	builder.WriteString("请基于以下信息条目输出「今日聚合速览」。这些条目可能是新闻、长文/博客观点、论坛讨论、工具资源或混合内容；不要默认按新闻稿方式总结。\n")
	builder.WriteString("阅读体验优先：输出要像给个人阅读器看的速览，不要像研究报告、表格清单或行业研报。用 Markdown 输出，并且只输出存在独立信息价值的 section。\n")
	builder.WriteString("输出结构：\n")
	builder.WriteString("## 优先阅读\n3-5 条 bullet。每条给文章标题、核心判断和一句为什么值得打开；保留最关键的数字或事实，但不在这里重复展开完整背景。\n")
	builder.WriteString("## 主要判断\n按主题组织 2-5 个小标题；每个主题 2-4 条 bullet。每个重要主题至少解释关键事实、因果关系、影响对象和后续变量中的两项。新闻写变化、影响与后续变量；长文写论点、证据和漏洞；论坛写共识、分歧与经验；工具写用途、适用对象与限制。\n")
	builder.WriteString("## 继续关注\n仅在存在未被前文说明的风险、不确定性或待验证事项时输出，最多 4 条。\n")
	builder.WriteString("## 今日结论\n用 2-3 句收束本期最重要的判断：读者今天最该记住什么，以及下一步最值得观察什么。不得引入前文没有出现的新事实。\n\n")
	builder.WriteString("要求：\n")
	builder.WriteString("- 同一事件的共同事实只完整表述一次；不要因为事件相同就丢弃其他来源独有的数字、背景、观点、质疑或后续进展。\n")
	builder.WriteString("- 当多个来源报道同一事件时，用“共同事实 + 来源差异”的方式组织；只有确实没有新信息的纯转载才可以忽略。\n")
	builder.WriteString("- 先判断内容类型：新闻写背景/影响/后续关注；长文写论点/证据/漏洞；论坛写观点阵营/共识/分歧/经验；工具资源写用途/适用人群/限制。\n")
	builder.WriteString("- 优先写真正新增、多源确认、讨论升温、论证质量高、经验密度高或影响较大的信息；信息不足或重复度高的条目可以忽略。\n")
	builder.WriteString("- 不要把所有主题写成同等重要；真正重要的主题放在前面，次要信息可以压缩。\n")
	builder.WriteString("- 内容类型只作为内部判断：news_event / essay_argument / forum_discussion / resource_tool / mixed；不要机械输出成分类清单。\n")
	builder.WriteString("- 正文中可以少量使用 [Axx] 作为原文引用；这些编号会在阅读器里变成可点击文章链接。\n")
	builder.WriteString("- 不要每一句都塞入 [Axx] 编号；只有关键判断、争议点、深读推荐需要定位原文时才引用编号。\n")
	builder.WriteString("- 保持中高信息密度：不要一句话带过重点；重要条目要补充关键数字、参与者、因果关系、市场/技术/用户影响或后续观察点。\n")
	builder.WriteString("- 输入达到 10 条以上时，通常应覆盖 4-8 个真正有独立价值的事件或论点；不要因为追求简短而漏掉明显重要的信息。\n")
	builder.WriteString("- 段落必须短。一个自然段最多 4 行；优先使用 bullet；避免 5 句以上的大段文字。\n")
	builder.WriteString("- 每个 bullet 只表达一个主判断，但可以补充 1-2 个支撑细节。不要把多个不相关事件塞进同一句。\n")
	builder.WriteString("- 同一核心事实只能完整表述一次；“优先阅读”只给推荐理由，“主要判断”才展开事实与推理。\n")
	builder.WriteString("- “继续关注”只能写前文没有解释过的独立不确定性，不得重复主题背景。\n")
	builder.WriteString("- 信息不足时可以少写，但不能用过度压缩代替判断；删除的是重复和噪音，不是关键细节。\n")
	builder.WriteString("- 只有需要读者定位原文的具体事实、关键判断或“优先阅读”条目才使用 [Axx] 引用。每个 bullet 最多一个引用；多源佐证时选择最直接的一篇，不要堆叠引用。\n")
	builder.WriteString("- 不要输出裸 URL、Markdown 外链或“原文”链接；阅读器会把 [Axx] 自动变成可点击的原文章入口。\n\n")
	builder.WriteString("信息条目：\n")
	for i, item := range items {
		builder.WriteString(fmt.Sprintf(
			"[A%02d] [%s/%s] %s\n",
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
	if strings.TrimSpace(raw) == "" && item.Content != nil {
		raw = *item.Content
	}
	text := textclean.NormalizeFromHTML(raw)
	if text == "" {
		return "无摘要"
	}
	const maxSnippetRunes = 320
	runes := []rune(text)
	if len(runes) > maxSnippetRunes {
		return string(runes[:maxSnippetRunes]) + "..."
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
