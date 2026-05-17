package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"quick/internal/models"
	"quick/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type SourceHandler struct {
	db               *gorm.DB
	httpClient       *http.Client
	redditHTTPClient *http.Client
	refresher        worker.Refresher
	rsshubBaseURL    string
}

type SourceHandlerOptions struct {
	RSSHubBaseURL string
}

func NewSourceHandler(db *gorm.DB, refresher worker.Refresher) *SourceHandler {
	return NewSourceHandlerWithOptions(db, refresher, SourceHandlerOptions{})
}

func NewSourceHandlerWithOptions(db *gorm.DB, refresher worker.Refresher, options SourceHandlerOptions) *SourceHandler {
	return &SourceHandler{
		db:               db,
		httpClient:       newHandlerHTTPClient(8*time.Second, false),
		redditHTTPClient: newHandlerHTTPClient(8*time.Second, true),
		refresher:        refresher,
		rsshubBaseURL:    normalizeRSSHubBaseURL(options.RSSHubBaseURL),
	}
}

func (h *SourceHandler) clientForURL(rawURL string) *http.Client {
	return pickHTTPClientForURL(rawURL, h.httpClient, h.redditHTTPClient)
}

func (h *SourceHandler) RegisterRoutes(group *gin.RouterGroup) {
	h.RegisterReadRoutes(group)
	h.RegisterWriteRoutes(group)
}

func (h *SourceHandler) RegisterReadRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.GET("/:id", h.Get)
}

func (h *SourceHandler) RegisterWriteRoutes(group *gin.RouterGroup) {
	group.POST("", h.Create)
	group.POST("/export", h.Export)
	group.POST("/import", h.Import)
	group.POST("/discover", h.Discover)
	group.POST("/reclassify", h.Reclassify)
	group.POST("/bulk/tags", h.BulkUpdateTags)
	group.PATCH("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
	group.POST("/:id/test", h.TestFeed)
	group.POST("/:id/refresh", h.Refresh)
}

type createSourceRequest struct {
	OwnerUserID           *uint64  `json:"owner_user_id"`
	Name                  string   `json:"name"`
	RSSURL                string   `json:"rss_url" binding:"required,url"`
	Tags                  []string `json:"tags"`
	Enabled               *bool    `json:"enabled"`
	PollIntervalSec       *int     `json:"poll_interval_sec"`
	AIBriefingEnabled     *bool    `json:"ai_briefing_enabled"`
	AIBriefingIntervalMin *int     `json:"ai_briefing_interval_min"`
}

type updateSourceRequest struct {
	Name                  *string   `json:"name"`
	RSSURL                *string   `json:"rss_url" binding:"omitempty,url"`
	Tags                  *[]string `json:"tags"`
	Enabled               *bool     `json:"enabled"`
	PollIntervalSec       *int      `json:"poll_interval_sec"`
	AIBriefingEnabled     *bool     `json:"ai_briefing_enabled"`
	AIBriefingIntervalMin *int      `json:"ai_briefing_interval_min"`
}

type discoverSourcesRequest struct {
	URL string `json:"url" binding:"required"`
}

type reclassifySourcesRequest struct {
	SourceIDs   []uint64 `json:"source_ids"`
	OnlyGeneral *bool    `json:"only_general"`
	Probe       *bool    `json:"probe"`
	DryRun      bool     `json:"dry_run"`
	Limit       *int     `json:"limit"`
}

type bulkUpdateSourceTagsRequest struct {
	SourceIDs []uint64 `json:"source_ids" binding:"required"`
	Action    string   `json:"action" binding:"required"`
	Tags      []string `json:"tags"`
}

type reclassifySourceResult struct {
	SourceID uint64             `json:"source_id"`
	Name     string             `json:"name"`
	RSSURL   string             `json:"rss_url"`
	OldTags  models.StringArray `json:"old_tags"`
	NewTags  models.StringArray `json:"new_tags"`
	Changed  bool               `json:"changed"`
	Reason   string             `json:"reason"`
	Error    string             `json:"error,omitempty"`
}

const threadAutoHideAfter = 14 * 24 * time.Hour
const sourceClassificationRecentArticleLimit = 24
const sourceClassificationSnippetLimit = 280

func recentArticleCountsSubquery(db *gorm.DB, window time.Duration) *gorm.DB {
	if window <= 0 {
		window = 24 * time.Hour
	}
	cutoff := time.Now().UTC().Add(-window)
	return db.
		Table("articles").
		Select("source_id, COUNT(*) AS new_articles_24h").
		Where("COALESCE(published_at, created_at) >= ?", cutoff).
		Group("source_id")
}

func (h *SourceHandler) baseSourceListQuery() *gorm.DB {
	counts := recentArticleCountsSubquery(h.db, 24*time.Hour)
	return h.db.
		Model(&models.Source{}).
		Select(`
			sources.id,
			sources.owner_user_id,
			sources.name,
			sources.rss_url,
			sources.site_key,
			sources.kind,
			sources.topic_url,
			sources.hidden_in_sidebar,
			sources.tags,
			sources.click_count,
			sources.last_clicked_at,
			sources.ai_briefing_enabled,
			sources.ai_briefing_interval_min,
			sources.ai_briefing_last_run_at,
			sources.ai_briefing_last_generated_at,
			sources.enabled,
			sources.poll_interval_sec,
			sources.last_fetched_at,
			sources.created_at,
			sources.updated_at,
			COALESCE(article_counts.new_articles_24h, 0) AS new_articles_24h
		`).
		Joins("LEFT JOIN (?) AS article_counts ON article_counts.source_id = sources.id", counts)
}

func (h *SourceHandler) List(c *gin.Context) {
	startedAt := time.Now()
	if err := h.autoHideStaleThreadSources(c.Request.Context(), threadAutoHideAfter); err != nil {
		internalServerError(c, "auto-hide stale thread sources failed", err)
		return
	}

	query := h.baseSourceListQuery()

	if ownerRaw := c.Query("owner_user_id"); ownerRaw != "" {
		ownerID, err := strconv.ParseUint(ownerRaw, 10, 64)
		if err != nil {
			badRequest(c, "owner_user_id must be an unsigned integer")
			return
		}
		query = query.Where("owner_user_id = ?", ownerID)
	}

	if tag := normalizeSourceTag(c.Query("tag")); tag != "" {
		query = query.Where("tags @> ?::text[]", models.StringArray{tag})
	}
	if kind := strings.TrimSpace(c.Query("kind")); kind != "" {
		query = query.Where("kind = ?", strings.ToLower(kind))
	}
	if hiddenRaw := strings.TrimSpace(c.Query("hidden_in_sidebar")); hiddenRaw != "" {
		hidden, err := strconv.ParseBool(hiddenRaw)
		if err != nil {
			badRequest(c, "hidden_in_sidebar must be true/false")
			return
		}
		query = query.Where("hidden_in_sidebar = ?", hidden)
	}

	if enabledRaw := c.Query("enabled"); enabledRaw != "" {
		enabled, err := strconv.ParseBool(enabledRaw)
		if err != nil {
			badRequest(c, "enabled must be true/false")
			return
		}
		query = query.Where("enabled = ?", enabled)
	}

	limit := 20
	if limitRaw := c.Query("limit"); limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 || value > 100 {
			badRequest(c, "limit must be an integer between 1 and 100")
			return
		}
		limit = value
	}

	offset := 0
	if offsetRaw := c.Query("offset"); offsetRaw != "" {
		value, err := strconv.Atoi(offsetRaw)
		if err != nil || value < 0 {
			badRequest(c, "offset must be an integer >= 0")
			return
		}
		offset = value
	}

	var sources []models.Source
	if err := query.
		Order("click_count DESC").
		Order("last_clicked_at DESC NULLS LAST").
		Order("id DESC").
		Limit(limit).
		Offset(offset).
		Find(&sources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}
	for i := range sources {
		normalizeSourceForResponse(&sources[i])
	}

	c.JSON(http.StatusOK, gin.H{
		"data": sources,
		"meta": gin.H{
			"limit":      limit,
			"offset":     offset,
			"count":      len(sources),
			"elapsed_ms": time.Since(startedAt).Milliseconds(),
		},
	})
}

func (h *SourceHandler) autoHideStaleThreadSources(ctx context.Context, staleAfter time.Duration) error {
	if staleAfter <= 0 {
		return nil
	}
	cutoff := time.Now().UTC().Add(-staleAfter)
	return h.db.WithContext(ctx).
		Model(&models.Source{}).
		Where("kind = ? AND hidden_in_sidebar = ?", "thread", false).
		Where(`GREATEST(
			COALESCE(last_fetched_at, to_timestamp(0)),
			COALESCE(last_clicked_at, to_timestamp(0)),
			COALESCE(updated_at, to_timestamp(0)),
			COALESCE(created_at, to_timestamp(0))
		) < ?`, cutoff).
		Update("hidden_in_sidebar", true).Error
}

func (h *SourceHandler) Get(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	var source models.Source
	if err := h.baseSourceListQuery().Where("sources.id = ?", id).First(&source).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			notFound(c, "source not found")
			return
		}
		internalServerError(c, "query source failed", err)
		return
	}
	normalizeSourceForResponse(&source)

	c.JSON(http.StatusOK, source)
}

func (h *SourceHandler) Create(c *gin.Context) {
	var req createSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	name := strings.TrimSpace(req.Name)
	rssURL, err := h.resolveSourceRSSURL(strings.TrimSpace(req.RSSURL))
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	tags := normalizeSourceTags(req.Tags)
	shouldInferTag := shouldInferFromProvidedTags(tags)

	var probe *probeResult
	if name == "" || shouldInferTag {
		result, err := h.probeFeed(rssURL)
		if err == nil {
			probe = result
		}
	}

	if name == "" {
		if probe != nil {
			name = strings.TrimSpace(probe.Title)
		}
		if name == "" {
			name = fallbackSourceNameFromURL(rssURL)
		}
	}
	if shouldInferTag {
		requestedTag := ""
		if len(tags) == 1 {
			requestedTag = tags[0]
		}
		tags = models.StringArray{resolveSourceTag(requestedTag, rssURL, probe)}
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	pollIntervalSec := 900
	if req.PollIntervalSec != nil {
		if *req.PollIntervalSec <= 0 {
			badRequest(c, "poll_interval_sec must be > 0")
			return
		}
		pollIntervalSec = *req.PollIntervalSec
	}

	aiBriefingEnabled := false
	if req.AIBriefingEnabled != nil {
		aiBriefingEnabled = *req.AIBriefingEnabled
	}
	aiBriefingIntervalMin := 360
	if req.AIBriefingIntervalMin != nil {
		if *req.AIBriefingIntervalMin <= 0 {
			badRequest(c, "ai_briefing_interval_min must be > 0")
			return
		}
		aiBriefingIntervalMin = *req.AIBriefingIntervalMin
	}

	source := models.Source{
		OwnerUserID:           req.OwnerUserID,
		Name:                  name,
		RSSURL:                rssURL,
		SiteKey:               normalizeSiteKey(rssURL),
		Kind:                  "feed",
		HiddenInSidebar:       false,
		Tags:                  mergeSourceTags(tags),
		AIBriefingEnabled:     aiBriefingEnabled,
		AIBriefingIntervalMin: aiBriefingIntervalMin,
		Enabled:               enabled,
		PollIntervalSec:       pollIntervalSec,
	}

	if err := h.db.Create(&source).Error; err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23505":
				c.JSON(http.StatusConflict, gin.H{"error": "source already exists for this owner and RSS URL"})
				return
			case "23503":
				badRequest(c, "invalid owner_user_id")
				return
			}
		}
		internalServerError(c, "create source failed", err)
		return
	}

	normalizeSourceForResponse(&source)
	c.JSON(http.StatusCreated, source)
}

func (h *SourceHandler) Reclassify(c *gin.Context) {
	var req reclassifySourcesRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	onlyGeneral := true
	if req.OnlyGeneral != nil {
		onlyGeneral = *req.OnlyGeneral
	}
	probeEnabled := true
	if req.Probe != nil {
		probeEnabled = *req.Probe
	}

	limit := 200
	if req.Limit != nil {
		if *req.Limit <= 0 || *req.Limit > 2000 {
			badRequest(c, "limit must be an integer between 1 and 2000")
			return
		}
		limit = *req.Limit
	}

	sourceIDs := uniqueUint64(req.SourceIDs)
	query := h.db.WithContext(c.Request.Context()).Model(&models.Source{}).Where("kind = ?", "feed")
	if len(sourceIDs) > 0 {
		query = query.Where("id IN ?", sourceIDs)
	}
	if onlyGeneral {
		query = query.Where("tags IS NULL OR cardinality(tags) = 0 OR tags[1] = ?", defaultSourceTag)
	}
	if len(sourceIDs) == 0 {
		query = query.Limit(limit)
	}

	var sources []models.Source
	if err := query.Order("id ASC").Find(&sources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}

	results := make([]reclassifySourceResult, 0, len(sources))
	changedCount := 0
	errorCount := 0
	for _, source := range sources {
		oldTags := mergeSourceTags(source.Tags)
		requestedTag := ""
		if len(oldTags) > 0 {
			requestedTag = oldTags[0]
		}

		probeReason := "rule"
		var probe *probeResult
		if probeEnabled {
			result, err := h.probeFeedWithContext(c.Request.Context(), source.RSSURL)
			if err != nil {
				probeReason = "rule (probe failed)"
			} else {
				probe = result
			}
		}

		var recentText []string
		reasonPrefix := ""
		if shouldAutoInferTag(requestedTag) {
			text, err := h.recentArticleClassificationText(c.Request.Context(), source.ID)
			if err != nil {
				reasonPrefix = "recent article scan failed; "
			} else {
				recentText = text
			}
		}
		newTag, reason := resolveSourceTagWithRecentText(requestedTag, source.RSSURL, probe, recentText)
		if probeReason != "rule" && reason == "rule" {
			reason = probeReason
		}
		reason = reasonPrefix + reason
		newTags := models.StringArray{newTag}

		entry := reclassifySourceResult{
			SourceID: source.ID,
			Name:     source.Name,
			RSSURL:   source.RSSURL,
			OldTags:  oldTags,
			NewTags:  newTags,
			Reason:   reason,
			Changed:  !equalStringArrays(oldTags, newTags),
		}

		if entry.Changed && !req.DryRun {
			if err := h.db.WithContext(c.Request.Context()).
				Model(&models.Source{}).
				Where("id = ?", source.ID).
				Updates(map[string]any{
					"tags":     newTags,
					"site_key": normalizeSiteKey(source.RSSURL),
				}).Error; err != nil {
				entry.Error = err.Error()
				errorCount++
			} else {
				changedCount++
			}
		} else if entry.Changed {
			changedCount++
		}

		results = append(results, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": results,
		"meta": gin.H{
			"count":        len(results),
			"changed":      changedCount,
			"errors":       errorCount,
			"only_general": onlyGeneral,
			"probe":        probeEnabled,
			"dry_run":      req.DryRun,
			"limit":        limit,
		},
	})
}

func (h *SourceHandler) recentArticleClassificationText(ctx context.Context, sourceID uint64) ([]string, error) {
	var articles []models.Article
	if err := h.db.WithContext(ctx).
		Model(&models.Article{}).
		Select("title", "summary", "content", "tags").
		Where("source_id = ?", sourceID).
		Order("COALESCE(published_at, created_at) DESC").
		Limit(sourceClassificationRecentArticleLimit).
		Find(&articles).Error; err != nil {
		return nil, err
	}

	text := make([]string, 0, len(articles))
	for _, article := range articles {
		if value := compactArticleClassificationText(article); value != "" {
			text = append(text, value)
		}
	}
	return text, nil
}

func compactArticleClassificationText(article models.Article) string {
	parts := make([]string, 0, 4)
	if title := compactClassificationSnippet(article.Title); title != "" {
		parts = append(parts, title)
	}
	if article.Summary != nil {
		if summary := compactClassificationSnippet(*article.Summary); summary != "" {
			parts = append(parts, summary)
		}
	}
	if article.Content != nil {
		if content := compactClassificationSnippet(*article.Content); content != "" {
			parts = append(parts, content)
		}
	}
	if len(article.Tags) > 0 {
		if tags := compactClassificationSnippet(strings.Join(article.Tags, " ")); tags != "" {
			parts = append(parts, tags)
		}
	}
	return strings.Join(parts, " ")
}

func compactClassificationSnippet(value string) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if normalized == "" {
		return ""
	}
	runes := []rune(normalized)
	if len(runes) <= sourceClassificationSnippetLimit {
		return normalized
	}
	return string(runes[:sourceClassificationSnippetLimit])
}

func (h *SourceHandler) BulkUpdateTags(c *gin.Context) {
	var req bulkUpdateSourceTagsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	sourceIDs := uniqueUint64(req.SourceIDs)
	if len(sourceIDs) == 0 {
		badRequest(c, "source_ids must contain at least one id")
		return
	}

	action := strings.ToLower(strings.TrimSpace(req.Action))
	switch action {
	case "add", "remove", "replace":
	default:
		badRequest(c, "action must be one of: add, remove, replace")
		return
	}

	tags := normalizeSourceTags(req.Tags)
	if len(tags) == 0 {
		badRequest(c, "tags must contain at least one non-empty value")
		return
	}

	var sources []models.Source
	if err := h.db.WithContext(c.Request.Context()).
		Where("id IN ?", sourceIDs).
		Find(&sources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}
	if len(sources) == 0 {
		notFound(c, "no sources found")
		return
	}

	updated := 0
	for _, source := range sources {
		oldTags := mergeSourceTags(source.Tags)
		newTags := applySourceTagBulkAction(oldTags, tags, action)
		if equalStringArrays(oldTags, newTags) {
			continue
		}
		if err := h.db.WithContext(c.Request.Context()).
			Model(&models.Source{}).
			Where("id = ?", source.ID).
			Update("tags", newTags).Error; err != nil {
			internalServerError(c, "bulk update tags failed", err)
			return
		}
		updated++
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"action":  action,
		"updated": updated,
		"total":   len(sources),
	})
}

func (h *SourceHandler) Update(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	var req updateSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	var source models.Source
	if err := h.db.First(&source, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			notFound(c, "source not found")
			return
		}
		internalServerError(c, "query source failed", err)
		return
	}

	updates := map[string]any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			badRequest(c, "name cannot be empty")
			return
		}
		updates["name"] = name
	}
	if req.RSSURL != nil {
		rssURL, err := h.resolveSourceRSSURL(strings.TrimSpace(*req.RSSURL))
		if err != nil {
			badRequest(c, err.Error())
			return
		}
		updates["rss_url"] = rssURL
		updates["site_key"] = normalizeSiteKey(rssURL)
		if shouldResetSourceFetchState(source.RSSURL, rssURL) {
			updates["etag"] = nil
			updates["last_modified"] = nil
			updates["last_fetched_at"] = nil
			updates["consecutive_failures"] = 0
			updates["last_error_at"] = nil
			updates["last_error_message"] = nil
		}
	}
	if req.Tags != nil {
		updates["tags"] = mergeSourceTags(*req.Tags)
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.PollIntervalSec != nil {
		if *req.PollIntervalSec <= 0 {
			badRequest(c, "poll_interval_sec must be > 0")
			return
		}
		updates["poll_interval_sec"] = *req.PollIntervalSec
	}
	if req.AIBriefingEnabled != nil {
		updates["ai_briefing_enabled"] = *req.AIBriefingEnabled
	}
	if req.AIBriefingIntervalMin != nil {
		if *req.AIBriefingIntervalMin <= 0 {
			badRequest(c, "ai_briefing_interval_min must be > 0")
			return
		}
		updates["ai_briefing_interval_min"] = *req.AIBriefingIntervalMin
	}

	if len(updates) == 0 {
		badRequest(c, "no fields to update")
		return
	}

	if err := h.db.Model(&source).Updates(updates).Error; err != nil {
		internalServerError(c, "update source failed", err)
		return
	}

	if err := h.db.First(&source, id).Error; err != nil {
		internalServerError(c, "query updated source failed", err)
		return
	}

	normalizeSourceForResponse(&source)
	c.JSON(http.StatusOK, source)
}

func (h *SourceHandler) Delete(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	result := h.db.Delete(&models.Source{}, id)
	if result.Error != nil {
		internalServerError(c, "delete source failed", result.Error)
		return
	}
	if result.RowsAffected == 0 {
		notFound(c, "source not found")
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *SourceHandler) TestFeed(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	var source models.Source
	if err := h.db.First(&source, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			notFound(c, "source not found")
			return
		}
		internalServerError(c, "query source failed", err)
		return
	}

	result, err := h.probeFeed(source.RSSURL)
	if err != nil {
		badGateway(c, fmt.Sprintf("feed test failed: %v", err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":          true,
		"source_id":   source.ID,
		"url":         source.RSSURL,
		"http_status": result.HTTPStatus,
		"feed_type":   result.FeedType,
		"title":       result.Title,
		"item_count":  result.ItemCount,
	})
}

func (h *SourceHandler) Refresh(c *gin.Context) {
	if h.refresher == nil {
		internalServerError(c, "refresh worker is not configured", errors.New("missing refresher"))
		return
	}

	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	refreshCtx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	if err := h.refresher.RefreshSource(refreshCtx, id); err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			notFound(c, "source not found")
		case errors.Is(err, worker.ErrSourceDisabled):
			badRequest(c, "source is disabled")
		case errors.Is(err, worker.ErrSourceBusy):
			c.JSON(http.StatusConflict, gin.H{"error": "source fetch is already in progress"})
		default:
			badGateway(c, fmt.Sprintf("refresh failed: %v", err))
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":        true,
		"source_id": id,
	})
}

func shouldResetSourceFetchState(previousRSSURL string, nextRSSURL string) bool {
	return canonicalizeURL(previousRSSURL) != canonicalizeURL(nextRSSURL)
}

func uniqueUint64(values []uint64) []uint64 {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[uint64]struct{}, len(values))
	out := make([]uint64, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
