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
}

const nonAdminBriefingModel = "gemini-3-flash-preview"
const feedBriefingSystemPrompt = "你是一个中文新闻编辑台 AI。请先在心里合并重复事件，再按重要性输出。优先保留真正新增、多源确认、讨论升温、影响较大的信息；不要把所有条目写成同等重要，也不要重复复述同一事件的背景。除首次提及外，同一核心事实不要在多个 section 里重复展开。"

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

	return &FeedHandler{
		db:               db,
		summarizer:       summarizer,
		adminAuthEnabled: options.AdminAuthEnabled,
		adminToken:       strings.TrimSpace(options.AdminToken),
		briefingLimiter:  newBriefingRateLimiter(rateLimit, time.Hour),
		briefingCooldown: newBriefingCooldownStore(cooldown),
	}
}

func (h *FeedHandler) RegisterRoutes(group *gin.RouterGroup) {
	h.RegisterReadRoutes(group)
	h.RegisterWriteRoutes(group)
}

func (h *FeedHandler) RegisterReadRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.GET("/briefings", h.ListBriefings)
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
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
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
	if dedupe {
		candidates := query.
			Order("COALESCE(a.published_at, a.created_at) DESC").
			Order("a.id DESC").
			Limit(feedDedupeCandidateLimit(limit))

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
				COUNT(*) OVER (PARTITION BY COALESCE(candidates.cluster_id, candidates.id)) AS duplicate_count,
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
			"elapsed_ms":  time.Since(startedAt).Milliseconds(),
		},
	})
}

func feedDedupeCandidateLimit(limit int) int {
	candidateLimit := limit * 50
	if candidateLimit < 500 {
		return 500
	}
	if candidateLimit > 3000 {
		return 3000
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
	promptRows := dedupeFeedBriefingRows(rows)
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

	prompt := buildFeedBriefingPrompt(promptRows)
	result, err := h.summarizer.CompleteWithModel(
		c.Request.Context(),
		feedBriefingSystemPrompt,
		prompt,
		effectiveModel,
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
		StopReason:  result.StopReason,
		GeneratedAt: result.GeneratedAt,
	}
	if err := h.db.WithContext(c.Request.Context()).
		Where("digest_key = ?", digestKey).
		Assign(record).
		FirstOrCreate(&record).Error; err != nil {
		internalServerError(c, "save feed briefing cache failed", err)
		return
	}
	h.briefingCooldown.Touch(digestKey, result.GeneratedAt)

	c.JSON(http.StatusOK, gin.H{
		"data": feedBriefingPayload{
			DigestKey:    digestKey,
			Summary:      result.Summary,
			Model:        result.Model,
			Provider:     result.ProviderName,
			InputChars:   result.InputChars,
			Truncated:    result.Truncated,
			StopReason:   result.StopReason,
			GeneratedAt:  result.GeneratedAt,
			CacheHit:     false,
			ArticleCount: len(promptRows),
			InputItems:   inputItems,
		},
	})
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
		"keyword=" + normalizeBriefingKeyword(keyword),
		"model=" + strings.TrimSpace(model),
		"source_ids=" + joinUint64(uniqueSources),
		"article_ids=" + joinUint64(articleIDs),
	}, "|")
	sum := sha1.Sum([]byte(payload))
	return hex.EncodeToString(sum[:]), articleIDs
}

func dedupeFeedBriefingRows(rows []feedItem) []feedItem {
	if len(rows) <= 1 {
		return rows
	}
	result := make([]feedItem, 0, len(rows))
	seenClusters := make(map[uint64]struct{}, len(rows))
	for _, row := range rows {
		if row.ClusterID == nil || *row.ClusterID == 0 {
			result = append(result, row)
			continue
		}
		clusterID := *row.ClusterID
		if _, ok := seenClusters[clusterID]; ok {
			continue
		}
		seenClusters[clusterID] = struct{}{}
		result = append(result, row)
	}
	return result
}

func resolveFeedBriefingModel(requestedModel string, summarizer *aisummary.Client, isAdmin bool) string {
	if !isAdmin {
		return nonAdminBriefingModel
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
		articleIDs = append(articleIDs, parseCSVUint64Loose(row.ArticleIDs)...)
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
		ids := parseCSVUint64Loose(row.ArticleIDs)
		if len(ids) == 0 {
			result[row.DigestKey] = nil
			continue
		}
		refs := make([]feedBriefingInputItem, 0, len(ids))
		for _, articleID := range ids {
			ref, ok := articleByID[articleID]
			if !ok {
				continue
			}
			refs = append(refs, ref)
		}
		result[row.DigestKey] = refs
	}
	return result, nil
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
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]uint64, 0, len(parts))
	for _, part := range parts {
		value, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil {
			continue
		}
		result = append(result, value)
	}
	return uniqueSortedUint64(result)
}

func buildFeedBriefingPrompt(items []feedItem) string {
	var builder strings.Builder
	builder.WriteString("请基于以下新闻列表输出「今日聚合速览」。\n")
	builder.WriteString("输出格式严格为：\n")
	builder.WriteString("1) 一句话总览（1-2句，只写最重要的总体变化）\n")
	builder.WriteString("2) 重点主题分组（2-4组，每组2-4条）\n")
	builder.WriteString("3) 风险/争议观察（最多4条；只写前文没有完整展开的新风险点）\n")
	builder.WriteString("4) 值得深读（最多6条，格式：标题｜链接URL｜一句理由；不要重复正文内容）\n\n")
	builder.WriteString("要求：\n")
	builder.WriteString("- 先合并相似事件；同一事件不要换个说法重复写多次。\n")
	builder.WriteString("- 优先写真正新增、多源确认、讨论升温或影响较大的信息；信息不足或重复度高的条目可以忽略。\n")
	builder.WriteString("- 不要把所有主题写成同等重要；真正重要的主题放在前面，次要信息可以压缩。\n")
	builder.WriteString("- 同一核心事实只能完整表述一次；后续 section 如果需要引用，只能极短指代，不得重复铺陈背景。\n")
	builder.WriteString("- 如果某条信息已经在“重点主题分组”里展开，就不要在“风险/争议观察”里再次完整重写。\n")
	builder.WriteString("- 宁可少写，也不要为了凑满 section 数量而重复已有信息。\n")
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
