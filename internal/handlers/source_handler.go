package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"quick/internal/models"
	"quick/internal/worker"

	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/net/publicsuffix"
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
	OwnerUserID     *uint64  `json:"owner_user_id"`
	Name            string   `json:"name"`
	RSSURL          string   `json:"rss_url" binding:"required,url"`
	Tags            []string `json:"tags"`
	Enabled         *bool    `json:"enabled"`
	PollIntervalSec *int     `json:"poll_interval_sec"`
}

type updateSourceRequest struct {
	Name            *string   `json:"name"`
	RSSURL          *string   `json:"rss_url" binding:"omitempty,url"`
	Tags            *[]string `json:"tags"`
	Enabled         *bool     `json:"enabled"`
	PollIntervalSec *int      `json:"poll_interval_sec"`
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

type sourceTransferItem struct {
	Name            string   `json:"name"`
	RSSURL          string   `json:"rss_url"`
	Tags            []string `json:"tags,omitempty"`
	Enabled         *bool    `json:"enabled,omitempty"`
	PollIntervalSec *int     `json:"poll_interval_sec,omitempty"`
	Kind            string   `json:"kind,omitempty"`
	HiddenInSidebar *bool    `json:"hidden_in_sidebar,omitempty"`
}

type sourceExportPayload struct {
	Version    string               `json:"version"`
	ExportedAt time.Time            `json:"exported_at"`
	Count      int                  `json:"count"`
	Sources    []sourceTransferItem `json:"sources"`
}

type sourceImportPayload struct {
	Sources []sourceTransferItem `json:"sources"`
}

type sourceImportResult struct {
	RSSURL   string  `json:"rss_url"`
	SourceID *uint64 `json:"source_id,omitempty"`
	Action   string  `json:"action"`
	Error    string  `json:"error,omitempty"`
}

type discoverCandidate struct {
	RSSURL       string  `json:"rss_url"`
	Name         string  `json:"name"`
	FeedType     string  `json:"feed_type"`
	ItemCount    int     `json:"item_count"`
	HTTPStatus   int     `json:"http_status"`
	Confidence   string  `json:"confidence"`
	Reason       string  `json:"reason"`
	Existing     bool    `json:"existing"`
	SourceID     *uint64 `json:"source_id,omitempty"`
	SourceName   *string `json:"source_name,omitempty"`
	SuggestedTag string  `json:"suggested_tag"`
}

type discoverSeed struct {
	URL    string
	Reason string
	Score  int
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

const defaultSourceTag = "general"
const threadAutoHideAfter = 14 * 24 * time.Hour

var sourceTagKeywordRules = []struct {
	Tag      string
	Keywords []string
}{
	{
		Tag:      "jobs",
		Keywords: []string{"hiring", "jobs", "job ", "career", "who is hiring"},
	},
	{
		Tag:      "finance",
		Keywords: []string{"finance", "market", "stocks", "invest", "economy", "fed", "interest rate", "credit card", "rewards", "points"},
	},
	{
		Tag:      "tech",
		Keywords: []string{"tech", "software", "developer", "programming", "open source", "hacker news", "ai", "startup", "github", "v2ex"},
	},
	{
		Tag:      "world",
		Keywords: []string{"world", "international", "geopolitic", "global", "election", "war"},
	},
	{
		Tag:      "science",
		Keywords: []string{"science", "research", "space", "physics", "biology", "medicine"},
	},
	{
		Tag:      "sports",
		Keywords: []string{"sports", "nfl", "nba", "soccer", "mlb", "tennis"},
	},
	{
		Tag:      "forum",
		Keywords: []string{"forum", "thread", "discussion", "community", "reddit", "comment"},
	},
}

func (h *SourceHandler) List(c *gin.Context) {
	if err := h.autoHideStaleThreadSources(c.Request.Context(), threadAutoHideAfter); err != nil {
		internalServerError(c, "auto-hide stale thread sources failed", err)
		return
	}

	query := h.db.Model(&models.Source{})

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
			"limit":  limit,
			"offset": offset,
			"count":  len(sources),
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
	if err := h.db.First(&source, id).Error; err != nil {
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

	source := models.Source{
		OwnerUserID:     req.OwnerUserID,
		Name:            name,
		RSSURL:          rssURL,
		SiteKey:         normalizeSiteKey(rssURL),
		Kind:            "feed",
		HiddenInSidebar: false,
		Tags:            mergeSourceTags(tags),
		Enabled:         enabled,
		PollIntervalSec: pollIntervalSec,
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

func (h *SourceHandler) Export(c *gin.Context) {
	var sources []models.Source
	if err := h.db.WithContext(c.Request.Context()).
		Order("id ASC").
		Find(&sources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}

	items := make([]sourceTransferItem, 0, len(sources))
	for _, source := range sources {
		enabled := source.Enabled
		pollInterval := source.PollIntervalSec
		hiddenInSidebar := source.HiddenInSidebar

		items = append(items, sourceTransferItem{
			Name:            strings.TrimSpace(source.Name),
			RSSURL:          strings.TrimSpace(source.RSSURL),
			Tags:            normalizeSourceTags(source.Tags),
			Enabled:         &enabled,
			PollIntervalSec: &pollInterval,
			Kind:            normalizeSourceKindValue(source.Kind),
			HiddenInSidebar: &hiddenInSidebar,
		})
	}

	c.JSON(http.StatusOK, sourceExportPayload{
		Version:    "quick.sources.v1",
		ExportedAt: time.Now().UTC(),
		Count:      len(items),
		Sources:    items,
	})
}

func (h *SourceHandler) Import(c *gin.Context) {
	rawBody, err := io.ReadAll(io.LimitReader(c.Request.Body, 4<<20))
	if err != nil {
		badRequest(c, fmt.Sprintf("read request body failed: %v", err))
		return
	}
	payload, err := parseSourceImportPayload(rawBody)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	if len(payload.Sources) == 0 {
		badRequest(c, "sources must contain at least one item")
		return
	}

	var existingSources []models.Source
	if err := h.db.WithContext(c.Request.Context()).Find(&existingSources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}
	existingByCanonical := make(map[string]models.Source, len(existingSources))
	for _, source := range existingSources {
		existingByCanonical[canonicalizeURL(source.RSSURL)] = source
	}

	seenInRequest := make(map[string]struct{}, len(payload.Sources))
	results := make([]sourceImportResult, 0, len(payload.Sources))
	createdCount := 0
	updatedCount := 0
	skippedCount := 0
	failedCount := 0

	for _, item := range payload.Sources {
		itemRSSURL := strings.TrimSpace(item.RSSURL)
		resolvedURL, err := h.resolveSourceRSSURL(itemRSSURL)
		if err != nil {
			failedCount++
			results = append(results, sourceImportResult{
				RSSURL: itemRSSURL,
				Action: "failed",
				Error:  err.Error(),
			})
			continue
		}

		canonicalURL := canonicalizeURL(resolvedURL)
		if _, exists := seenInRequest[canonicalURL]; exists {
			skippedCount++
			results = append(results, sourceImportResult{
				RSSURL: resolvedURL,
				Action: "skipped",
				Error:  "duplicate rss_url in import payload",
			})
			continue
		}
		seenInRequest[canonicalURL] = struct{}{}

		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = fallbackSourceNameFromURL(resolvedURL)
		}

		tags := normalizeSourceTags(item.Tags)
		if shouldInferFromProvidedTags(tags) {
			tags = models.StringArray{resolveSourceTag("", resolvedURL, nil)}
		}

		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}

		pollIntervalSec := 900
		if item.PollIntervalSec != nil {
			if *item.PollIntervalSec <= 0 {
				failedCount++
				results = append(results, sourceImportResult{
					RSSURL: resolvedURL,
					Action: "failed",
					Error:  "poll_interval_sec must be > 0",
				})
				continue
			}
			pollIntervalSec = *item.PollIntervalSec
		}

		kind := normalizeSourceKindValue(item.Kind)
		hiddenInSidebar := false
		if item.HiddenInSidebar != nil {
			hiddenInSidebar = *item.HiddenInSidebar
		}

		existing, found := existingByCanonical[canonicalURL]
		if found {
			updates := map[string]any{
				"name":              name,
				"rss_url":           resolvedURL,
				"site_key":          normalizeSiteKey(resolvedURL),
				"kind":              kind,
				"hidden_in_sidebar": hiddenInSidebar,
				"tags":              mergeSourceTags(tags),
				"enabled":           enabled,
				"poll_interval_sec": pollIntervalSec,
			}
			if err := h.db.WithContext(c.Request.Context()).
				Model(&models.Source{}).
				Where("id = ?", existing.ID).
				Updates(updates).Error; err != nil {
				failedCount++
				results = append(results, sourceImportResult{
					RSSURL:   resolvedURL,
					SourceID: &existing.ID,
					Action:   "failed",
					Error:    err.Error(),
				})
				continue
			}
			updatedCount++
			results = append(results, sourceImportResult{
				RSSURL:   resolvedURL,
				SourceID: &existing.ID,
				Action:   "updated",
			})
			continue
		}

		source := models.Source{
			Name:            name,
			RSSURL:          resolvedURL,
			SiteKey:         normalizeSiteKey(resolvedURL),
			Kind:            kind,
			HiddenInSidebar: hiddenInSidebar,
			Tags:            mergeSourceTags(tags),
			Enabled:         enabled,
			PollIntervalSec: pollIntervalSec,
		}
		if err := h.db.WithContext(c.Request.Context()).Create(&source).Error; err != nil {
			failedCount++
			results = append(results, sourceImportResult{
				RSSURL: resolvedURL,
				Action: "failed",
				Error:  err.Error(),
			})
			continue
		}
		createdCount++
		results = append(results, sourceImportResult{
			RSSURL:   resolvedURL,
			SourceID: &source.ID,
			Action:   "created",
		})
		existingByCanonical[canonicalURL] = source
	}

	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"meta": gin.H{
			"total":   len(payload.Sources),
			"created": createdCount,
			"updated": updatedCount,
			"skipped": skippedCount,
			"failed":  failedCount,
		},
		"data": results,
	})
}

func (h *SourceHandler) Discover(c *gin.Context) {
	var req discoverSourcesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	seedURL, err := normalizeDiscoverInputURL(req.URL)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	seeds := h.discoverFeedSeeds(c.Request.Context(), seedURL)
	if len(seeds) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"data": []discoverCandidate{},
			"meta": gin.H{
				"seed_url":     seedURL.String(),
				"count":        0,
				"probed_count": 0,
			},
		})
		return
	}

	const maxProbe = 12
	limit := maxProbe
	if len(seeds) < limit {
		limit = len(seeds)
	}

	discovered := make([]discoverCandidate, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, seed := range seeds[:limit] {
		probe, err := h.probeFeedWithContext(c.Request.Context(), seed.URL)
		if err != nil {
			continue
		}

		normalized := canonicalizeURL(seed.URL)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}

		discovered = append(discovered, discoverCandidate{
			RSSURL:       seed.URL,
			Name:         firstNonEmptyTrimmed(probe.Title, fallbackSourceNameFromURL(seed.URL)),
			FeedType:     probe.FeedType,
			ItemCount:    probe.ItemCount,
			HTTPStatus:   probe.HTTPStatus,
			Confidence:   confidenceFromScore(seed.Score),
			Reason:       seed.Reason,
			SuggestedTag: resolveSourceTag("", seed.URL, probe),
		})
	}

	if len(discovered) > 0 {
		byURL := make(map[string]int, len(discovered))
		urls := make([]string, 0, len(discovered))
		for idx, item := range discovered {
			normalized := canonicalizeURL(item.RSSURL)
			byURL[normalized] = idx
			urls = append(urls, item.RSSURL)
		}

		var existing []models.Source
		if err := h.db.WithContext(c.Request.Context()).Where("rss_url IN ?", urls).Find(&existing).Error; err == nil {
			for _, source := range existing {
				normalized := canonicalizeURL(source.RSSURL)
				idx, ok := byURL[normalized]
				if !ok {
					continue
				}
				discovered[idx].Existing = true
				discovered[idx].SourceID = &source.ID
				name := source.Name
				discovered[idx].SourceName = &name
			}
		}
	}

	sort.Slice(discovered, func(i, j int) bool {
		if discovered[i].Existing != discovered[j].Existing {
			return !discovered[i].Existing
		}
		if discovered[i].Confidence != discovered[j].Confidence {
			return confidenceRank(discovered[i].Confidence) > confidenceRank(discovered[j].Confidence)
		}
		return discovered[i].RSSURL < discovered[j].RSSURL
	})

	c.JSON(http.StatusOK, gin.H{
		"data": discovered,
		"meta": gin.H{
			"seed_url":     seedURL.String(),
			"count":        len(discovered),
			"probed_count": limit,
		},
	})
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

		requestedTag := ""
		if len(oldTags) > 0 {
			requestedTag = oldTags[0]
		}
		newTag, reason := resolveSourceTagWithReason(requestedTag, source.RSSURL, probe)
		if probeReason != "rule" && reason == "rule" {
			reason = probeReason
		}
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

type probeResult struct {
	HTTPStatus int
	FeedType   string
	Title      string
	ItemCount  int
	SampleText []string
}

type probeRSSItem struct {
	Title       string   `xml:"title"`
	Categories  []string `xml:"category"`
	Description string   `xml:"description"`
}

type probeAtomEntry struct {
	Title   string `xml:"title"`
	Summary string `xml:"summary"`
	Content string `xml:"content"`
}

func (h *SourceHandler) probeFeed(feedURL string) (*probeResult, error) {
	return h.probeFeedWithContext(context.Background(), feedURL)
}

func parseSourceImportPayload(rawBody []byte) (sourceImportPayload, error) {
	trimmed := bytes.TrimSpace(rawBody)
	if len(trimmed) == 0 {
		return sourceImportPayload{}, errors.New("request body is empty")
	}

	var payload sourceImportPayload
	switch trimmed[0] {
	case '[':
		var sources []sourceTransferItem
		if err := json.Unmarshal(trimmed, &sources); err != nil {
			return sourceImportPayload{}, fmt.Errorf("invalid import payload: %w", err)
		}
		payload.Sources = sources
		return payload, nil
	case '{':
		if err := json.Unmarshal(trimmed, &payload); err != nil {
			return sourceImportPayload{}, fmt.Errorf("invalid import payload: %w", err)
		}
		if len(payload.Sources) > 0 {
			return payload, nil
		}

		var wrapped struct {
			Data sourceImportPayload `json:"data"`
		}
		if err := json.Unmarshal(trimmed, &wrapped); err == nil && len(wrapped.Data.Sources) > 0 {
			return wrapped.Data, nil
		}
		return payload, nil
	default:
		return sourceImportPayload{}, errors.New("invalid import payload: expected JSON object or array")
	}
}

func (h *SourceHandler) probeFeedWithContext(ctx context.Context, feedURL string) (*probeResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "quick-news-aggregator/0.1")

	resp, err := h.clientForURL(feedURL).Do(req)
	logRedditHTTPResult("source.probeFeed", feedURL, resp, err)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	decoder := xml.NewDecoder(io.LimitReader(resp.Body, 2<<20))
	var feed struct {
		XMLName xml.Name `xml:""`
		Title   string   `xml:"title"`
		Channel struct {
			Title string         `xml:"title"`
			Items []probeRSSItem `xml:"item"`
		} `xml:"channel"`
		Entries []probeAtomEntry `xml:"entry"`
	}

	if err := decoder.Decode(&feed); err != nil {
		return nil, fmt.Errorf("parse xml: %w", err)
	}

	result := &probeResult{
		HTTPStatus: resp.StatusCode,
		FeedType:   "unknown",
	}

	switch feed.XMLName.Local {
	case "rss":
		result.FeedType = "rss"
		result.Title = feed.Channel.Title
		result.ItemCount = len(feed.Channel.Items)
		result.SampleText = sampleTextFromRSSItems(feed.Channel.Items)
	case "feed":
		result.FeedType = "atom"
		result.Title = feed.Title
		result.ItemCount = len(feed.Entries)
		result.SampleText = sampleTextFromAtomEntries(feed.Entries)
	default:
		if len(feed.Channel.Items) > 0 {
			result.FeedType = "rss"
			result.Title = feed.Channel.Title
			result.ItemCount = len(feed.Channel.Items)
			result.SampleText = sampleTextFromRSSItems(feed.Channel.Items)
		}
	}

	return result, nil
}

func (h *SourceHandler) discoverFeedSeeds(ctx context.Context, seedURL *url.URL) []discoverSeed {
	seedByURL := map[string]discoverSeed{}
	addSeed := func(rawURL string, reason string, score int) {
		normalized, ok := normalizeCandidateURL(seedURL, rawURL)
		if !ok {
			return
		}

		previous, exists := seedByURL[normalized]
		if !exists || score > previous.Score {
			seedByURL[normalized] = discoverSeed{
				URL:    normalized,
				Reason: reason,
				Score:  score,
			}
		}
	}

	seedURLString := seedURL.String()
	if isLikelyFeedURL(seedURLString) {
		addSeed(seedURLString, "输入地址本身是 RSS/Atom", 100)
	}

	root := &url.URL{
		Scheme: seedURL.Scheme,
		Host:   seedURL.Host,
		Path:   "/",
	}
	addCommonFeedPaths(addSeed, root)
	addHostSpecificFeedPaths(addSeed, root)

	htmlBody, finalURL, _, err := h.fetchBody(ctx, seedURLString, "text/html,application/xhtml+xml", 2<<20)
	if err == nil {
		for _, discovered := range extractFeedLinksFromHTML(finalURL, htmlBody) {
			addSeed(discovered, "页面 <link rel=alternate>", 95)
		}
		for _, discovered := range extractFeedLikeURLsFromText(string(htmlBody)) {
			addSeed(discovered, "页面中的 feed 链接", 70)
		}
	}

	sitemapQueue := make([]string, 0, 6)
	addSitemap := func(rawURL string) {
		candidate, ok := normalizeCandidateURL(root, rawURL)
		if !ok {
			return
		}
		sitemapQueue = append(sitemapQueue, candidate)
	}

	robotsURL := root.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
	if robotsBody, _, _, err := h.fetchBody(ctx, robotsURL, "text/plain,*/*", 512<<10); err == nil {
		for _, candidate := range extractFeedLikeURLsFromText(string(robotsBody)) {
			addSeed(candidate, "robots.txt 声明", 65)
		}
		for _, sitemapURL := range extractSitemapURLsFromRobots(string(robotsBody)) {
			addSitemap(sitemapURL)
		}
	}
	addSitemap(root.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String())

	visitedSitemap := map[string]struct{}{}
	for len(sitemapQueue) > 0 && len(visitedSitemap) < 4 {
		current := sitemapQueue[0]
		sitemapQueue = sitemapQueue[1:]
		if _, ok := visitedSitemap[current]; ok {
			continue
		}
		visitedSitemap[current] = struct{}{}

		body, _, _, err := h.fetchBody(ctx, current, "application/xml,text/xml,*/*", 2<<20)
		if err != nil {
			continue
		}
		locURLs, nestedSitemaps := extractSitemapLocURLs(body)
		for _, candidate := range locURLs {
			if !isLikelyFeedURL(candidate) {
				continue
			}
			addSeed(candidate, "sitemap 收录", 72)
		}
		for _, nested := range nestedSitemaps {
			addSitemap(nested)
		}
	}

	seeds := make([]discoverSeed, 0, len(seedByURL))
	for _, seed := range seedByURL {
		seeds = append(seeds, seed)
	}
	sort.Slice(seeds, func(i, j int) bool {
		if seeds[i].Score != seeds[j].Score {
			return seeds[i].Score > seeds[j].Score
		}
		return seeds[i].URL < seeds[j].URL
	})
	if len(seeds) > 24 {
		seeds = seeds[:24]
	}
	return seeds
}

func (h *SourceHandler) fetchBody(
	ctx context.Context,
	rawURL string,
	accept string,
	maxBytes int64,
) ([]byte, string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("User-Agent", "quick-news-aggregator/0.1")
	if strings.TrimSpace(accept) != "" {
		req.Header.Set("Accept", accept)
	}

	resp, err := h.clientForURL(rawURL).Do(req)
	logRedditHTTPResult("source.fetchBody", rawURL, resp, err)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, "", "", fmt.Errorf("status=%d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return nil, "", "", err
	}
	finalURL := rawURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	return body, finalURL, strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type"))), nil
}

func normalizeDiscoverInputURL(raw string) (*url.URL, error) {
	input := strings.TrimSpace(raw)
	if input == "" {
		return nil, fmt.Errorf("url is required")
	}
	if !strings.Contains(input, "://") {
		input = "https://" + input
	}

	parsed, err := url.Parse(input)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("url scheme must be http or https")
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return nil, fmt.Errorf("url host is required")
	}
	if strings.TrimSpace(parsed.Path) == "" {
		parsed.Path = "/"
	}
	parsed.Fragment = ""
	return parsed, nil
}

func normalizeCandidateURL(base *url.URL, raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}

	ref, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	if base != nil {
		ref = base.ResolveReference(ref)
	}
	if ref.Scheme != "http" && ref.Scheme != "https" {
		return "", false
	}
	if strings.TrimSpace(ref.Hostname()) == "" {
		return "", false
	}
	ref.Fragment = ""
	return canonicalizeURL(ref.String()), true
}

func canonicalizeURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	parsed.Fragment = ""
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	parsed.Scheme = strings.ToLower(strings.TrimSpace(parsed.Scheme))

	if parsed.Path != "/" {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	}
	return parsed.String()
}

const defaultRSSHubBaseURL = "http://127.0.0.1:1200"

func normalizeRSSHubBaseURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultRSSHubBaseURL
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return defaultRSSHubBaseURL
	}
	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "http" && scheme != "https" {
		return defaultRSSHubBaseURL
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return defaultRSSHubBaseURL
	}
	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	if parsed.Path != "/" {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	}
	return parsed.String()
}

func (h *SourceHandler) resolveSourceRSSURL(rawURL string) (string, error) {
	value := strings.TrimSpace(rawURL)
	if value == "" {
		return "", errors.New("rss_url cannot be empty")
	}
	expanded, err := expandRSSHubAliasURL(value, h.rsshubBaseURL)
	if err != nil {
		return "", err
	}
	return expanded, nil
}

func expandRSSHubAliasURL(rawURL string, baseURL string) (string, error) {
	value := strings.TrimSpace(rawURL)
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid rss_url: %w", err)
	}
	if strings.ToLower(strings.TrimSpace(parsed.Scheme)) != "rsshub" {
		return value, nil
	}

	base, err := url.Parse(normalizeRSSHubBaseURL(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid rsshub base url: %w", err)
	}

	routeParts := make([]string, 0, 8)
	if hostSegment := strings.TrimSpace(parsed.Hostname()); hostSegment != "" {
		routeParts = append(routeParts, hostSegment)
	}
	for _, part := range strings.Split(strings.Trim(parsed.Path, "/"), "/") {
		normalized := strings.TrimSpace(part)
		if normalized == "" {
			continue
		}
		routeParts = append(routeParts, normalized)
	}
	if len(routeParts) == 0 {
		return "", errors.New("rsshub url must include route path")
	}

	pathParts := make([]string, 0, len(routeParts)+1)
	if basePath := strings.Trim(base.Path, "/"); basePath != "" {
		pathParts = append(pathParts, strings.Split(basePath, "/")...)
	}
	pathParts = append(pathParts, routeParts...)
	base.Path = "/" + strings.Join(pathParts, "/")
	base.RawQuery = parsed.RawQuery
	base.Fragment = ""
	return base.String(), nil
}

func addCommonFeedPaths(add func(string, string, int), root *url.URL) {
	paths := []string{
		"/feed",
		"/feed.xml",
		"/rss",
		"/rss.xml",
		"/atom.xml",
		"/index.xml",
		"/?feed=rss",
	}
	for _, pathValue := range paths {
		ref, err := url.Parse(pathValue)
		if err != nil {
			continue
		}
		add(root.ResolveReference(ref).String(), "常见 feed 路径", 58)
	}
}

func addHostSpecificFeedPaths(add func(string, string, int), root *url.URL) {
	host := strings.ToLower(strings.TrimSpace(root.Hostname()))
	switch host {
	case "www.uscardforum.com", "uscardforum.com":
		add(root.ResolveReference(&url.URL{Path: "/top.rss"}).String(), "Discourse top", 88)
		add(root.ResolveReference(&url.URL{Path: "/latest.rss"}).String(), "Discourse latest", 82)
	case "news.ycombinator.com":
		add("https://hnrss.org/frontpage", "Hacker News RSS 镜像", 84)
		add("https://hnrss.org/best", "Hacker News RSS 镜像", 84)
	case "www.v2ex.com", "v2ex.com":
		add(root.ResolveReference(&url.URL{Path: "/index.xml"}).String(), "V2EX feed", 80)
	}
}

func extractFeedLinksFromHTML(baseURL string, body []byte) []string {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil
	}

	base, _ := url.Parse(baseURL)
	seen := map[string]struct{}{}
	feeds := make([]string, 0, 8)
	appendFeed := func(rawHref string) {
		normalized, ok := normalizeCandidateURL(base, rawHref)
		if !ok {
			return
		}
		if _, exists := seen[normalized]; exists {
			return
		}
		seen[normalized] = struct{}{}
		feeds = append(feeds, normalized)
	}

	doc.Find("link[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok || strings.TrimSpace(href) == "" {
			return
		}
		rel := strings.ToLower(strings.TrimSpace(attrOrEmpty(s, "rel")))
		typ := strings.ToLower(strings.TrimSpace(attrOrEmpty(s, "type")))
		if strings.Contains(rel, "alternate") &&
			(strings.Contains(typ, "rss") || strings.Contains(typ, "atom") || strings.Contains(typ, "xml") || isLikelyFeedURL(href)) {
			appendFeed(href)
		}
	})

	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok || !isLikelyFeedURL(href) {
			return
		}
		appendFeed(href)
	})

	return feeds
}

func extractFeedLikeURLsFromText(input string) []string {
	if strings.TrimSpace(input) == "" {
		return nil
	}
	splitter := func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == '"' || r == '\'' || r == '<' || r == '>'
	}
	parts := strings.FieldsFunc(input, splitter)
	seen := map[string]struct{}{}
	urls := make([]string, 0, 8)
	for _, token := range parts {
		if !(strings.HasPrefix(token, "http://") || strings.HasPrefix(token, "https://")) {
			continue
		}
		token = strings.TrimSpace(strings.TrimRight(token, ".,);"))
		if !isLikelyFeedURL(token) {
			continue
		}
		normalized := canonicalizeURL(token)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		urls = append(urls, normalized)
	}
	return urls
}

func extractSitemapURLsFromRobots(input string) []string {
	lines := strings.Split(input, "\n")
	result := make([]string, 0, 4)
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(text), "sitemap:") {
			continue
		}
		value := strings.TrimSpace(text[len("sitemap:"):])
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

func extractSitemapLocURLs(body []byte) (locURLs []string, sitemapURLs []string) {
	var parsed struct {
		URLs []struct {
			Loc string `xml:"loc"`
		} `xml:"url"`
		Sitemaps []struct {
			Loc string `xml:"loc"`
		} `xml:"sitemap"`
	}

	decoder := xml.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&parsed); err != nil {
		return nil, nil
	}
	for _, item := range parsed.URLs {
		value := strings.TrimSpace(item.Loc)
		if value != "" {
			locURLs = append(locURLs, value)
		}
	}
	for _, item := range parsed.Sitemaps {
		value := strings.TrimSpace(item.Loc)
		if value != "" {
			sitemapURLs = append(sitemapURLs, value)
		}
	}
	return locURLs, sitemapURLs
}

func isLikelyFeedURL(rawURL string) bool {
	value := strings.ToLower(strings.TrimSpace(rawURL))
	if value == "" {
		return false
	}
	return strings.Contains(value, "rss") ||
		strings.Contains(value, "atom") ||
		strings.Contains(value, "/feed") ||
		strings.Contains(value, ".xml")
}

func attrOrEmpty(selection *goquery.Selection, name string) string {
	value, ok := selection.Attr(name)
	if !ok {
		return ""
	}
	return value
}

func confidenceFromScore(score int) string {
	switch {
	case score >= 88:
		return "high"
	case score >= 70:
		return "medium"
	default:
		return "low"
	}
}

func confidenceRank(value string) int {
	switch value {
	case "high":
		return 3
	case "medium":
		return 2
	default:
		return 1
	}
}

func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func sampleTextFromRSSItems(items []probeRSSItem) []string {
	const maxItems = 8
	samples := make([]string, 0, maxItems)
	for i, item := range items {
		if i >= maxItems {
			break
		}
		text := firstNonEmptyTrimmed(item.Title, strings.Join(item.Categories, " "), item.Description)
		if text == "" {
			continue
		}
		samples = append(samples, compactFeedText(text))
	}
	return samples
}

func sampleTextFromAtomEntries(entries []probeAtomEntry) []string {
	const maxItems = 8
	samples := make([]string, 0, maxItems)
	for i, entry := range entries {
		if i >= maxItems {
			break
		}
		text := firstNonEmptyTrimmed(entry.Title, entry.Summary, entry.Content)
		if text == "" {
			continue
		}
		samples = append(samples, compactFeedText(text))
	}
	return samples
}

func compactFeedText(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	text = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ").Replace(text)
	text = strings.Join(strings.Fields(text), " ")
	return text
}

func shouldResetSourceFetchState(previousRSSURL string, nextRSSURL string) bool {
	return canonicalizeURL(previousRSSURL) != canonicalizeURL(nextRSSURL)
}

func normalizeSourceForResponse(source *models.Source) {
	if source == nil {
		return
	}
	source.Name = normalizeDisplaySourceName(source.Name, source.RSSURL)
	source.SiteKey = normalizeSiteKey(source.RSSURL)
	source.Tags = mergeSourceTags(source.Tags)
}

func normalizeDisplaySourceName(currentName string, rssURL string) string {
	name := strings.TrimSpace(currentName)
	if name == "" {
		return fallbackSourceNameFromURL(rssURL)
	}

	u, err := url.Parse(strings.TrimSpace(rssURL))
	if err != nil || !isRSSHubProviderURL(u) {
		return name
	}

	host := strings.TrimSpace(u.Hostname())
	if host == "" {
		return name
	}
	if !strings.EqualFold(name, host) {
		return name
	}

	if segment := firstPathSegment(u.Path); segment != "" {
		return segment
	}
	return name
}

func mergeSourceTags(rawTags []string) models.StringArray {
	tags := normalizeSourceTags(rawTags)
	if len(tags) == 0 {
		tags = append(tags, defaultSourceTag)
	}
	return tags
}

func normalizeSourceTags(rawTags []string) models.StringArray {
	if len(rawTags) == 0 {
		return models.StringArray{}
	}
	seen := make(map[string]struct{}, len(rawTags))
	out := make(models.StringArray, 0, len(rawTags))
	for _, raw := range rawTags {
		tag := normalizeSourceTag(raw)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}

func normalizeSourceTag(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func normalizeSourceKindValue(raw string) string {
	kind := strings.ToLower(strings.TrimSpace(raw))
	switch kind {
	case "thread":
		return "thread"
	case "feed":
		return "feed"
	default:
		return "feed"
	}
}

func containsSourceTag(tags []string, candidate string) bool {
	for _, tag := range tags {
		if normalizeSourceTag(tag) == candidate {
			return true
		}
	}
	return false
}

func shouldAutoInferTag(tag string) bool {
	value := strings.ToLower(strings.TrimSpace(tag))
	return value == "" || value == defaultSourceTag || value == "auto"
}

func shouldInferFromProvidedTags(tags []string) bool {
	if len(tags) == 0 {
		return true
	}
	return len(tags) == 1 && shouldAutoInferTag(tags[0])
}

func resolveSourceTag(requestedTag string, rssURL string, probe *probeResult) string {
	tag, _ := resolveSourceTagWithReason(requestedTag, rssURL, probe)
	return tag
}

func resolveSourceTagWithReason(requestedTag string, rssURL string, probe *probeResult) (string, string) {
	if !shouldAutoInferTag(requestedTag) {
		return strings.TrimSpace(requestedTag), "explicit"
	}

	if tag, ok := inferSourceTagByRule(rssURL); ok {
		return tag, "rule"
	}

	if tag := inferSourceTagByKeywords(rssURL, probe); tag != "" {
		return tag, "keywords"
	}

	return defaultSourceTag, "fallback"
}

func inferSourceTagByRule(rssURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rssURL))
	if err != nil {
		return "", false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	path := strings.ToLower(strings.TrimSpace(parsed.Path))

	switch {
	case host == "hnrss.org" || host == "news.ycombinator.com":
		return "tech", true
	case host == "www.uscardforum.com" || host == "uscardforum.com":
		return "forum", true
	case host == "www.reddit.com" || host == "reddit.com" || host == "old.reddit.com" || host == "redd.it":
		return "forum", true
	case host == "www.v2ex.com" || host == "v2ex.com":
		return "tech", true
	case strings.Contains(host, "bloomberg.com"):
		return "finance", true
	case strings.Contains(host, "espn.com"):
		return "sports", true
	case strings.Contains(host, "nature.com") || strings.Contains(host, "science.org"):
		return "science", true
	case isRSSHubProviderURL(parsed):
		segment := firstPathSegment(path)
		switch segment {
		case "v2ex", "hackernews", "github":
			return "tech", true
		case "reddit", "1point3acres", "uscardforum", "nga", "tieba":
			return "forum", true
		case "bloomberg":
			return "finance", true
		}
	}
	return "", false
}

func inferSourceTagByKeywords(rssURL string, probe *probeResult) string {
	parts := []string{strings.ToLower(strings.TrimSpace(rssURL))}
	if probe != nil {
		if title := strings.ToLower(strings.TrimSpace(probe.Title)); title != "" {
			parts = append(parts, title)
		}
		for _, sample := range probe.SampleText {
			if text := strings.ToLower(strings.TrimSpace(sample)); text != "" {
				parts = append(parts, text)
			}
		}
	}
	corpus := strings.Join(parts, " ")
	if corpus == "" {
		return ""
	}

	bestTag := ""
	bestScore := 0
	for _, rule := range sourceTagKeywordRules {
		score := 0
		for _, keyword := range rule.Keywords {
			if strings.Contains(corpus, keyword) {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			bestTag = rule.Tag
		}
	}

	if bestScore < 2 {
		return ""
	}
	return bestTag
}

func equalStringArrays(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if normalizeSourceTag(left[i]) != normalizeSourceTag(right[i]) {
			return false
		}
	}
	return true
}

func applySourceTagBulkAction(current []string, tags []string, action string) models.StringArray {
	base := mergeSourceTags(current)
	target := normalizeSourceTags(tags)
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "replace":
		return mergeSourceTags(target)
	case "remove":
		return removeSourceTags(base, target)
	default:
		return mergeSourceTags(append(base, target...))
	}
}

func removeSourceTags(current []string, toRemove []string) models.StringArray {
	if len(current) == 0 {
		return mergeSourceTags(nil)
	}
	removeSet := make(map[string]struct{}, len(toRemove))
	for _, tag := range toRemove {
		value := normalizeSourceTag(tag)
		if value == "" {
			continue
		}
		removeSet[value] = struct{}{}
	}
	if len(removeSet) == 0 {
		return mergeSourceTags(current)
	}

	next := make([]string, 0, len(current))
	for _, tag := range current {
		value := normalizeSourceTag(tag)
		if value == "" {
			continue
		}
		if _, exists := removeSet[value]; exists {
			continue
		}
		next = append(next, value)
	}
	return mergeSourceTags(next)
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

func fallbackSourceNameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err == nil {
		if isRSSHubProviderURL(u) {
			if segment := firstPathSegment(u.Path); segment != "" {
				return segment
			}
		}
		host := strings.TrimSpace(u.Hostname())
		if host != "" {
			return host
		}
	}
	return "Unnamed Source"
}

func normalizeSiteKey(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "unknown-site"
	}
	host := strings.TrimSpace(strings.ToLower(u.Hostname()))
	if host == "" {
		return "unknown-site"
	}
	if isRSSHubProviderURL(u) {
		firstSegment := firstPathSegment(u.Path)
		if firstSegment != "" {
			return firstSegment
		}
	}
	eTLD1, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err == nil && strings.TrimSpace(eTLD1) != "" {
		return strings.ToLower(eTLD1)
	}
	return host
}

func firstPathSegment(pathValue string) string {
	trimmed := strings.Trim(pathValue, "/")
	if trimmed == "" {
		return ""
	}
	parts := strings.Split(trimmed, "/")
	for _, part := range parts {
		normalized := strings.TrimSpace(strings.ToLower(part))
		if normalized != "" {
			return normalized
		}
	}
	return ""
}

func isRSSHubHost(host string) bool {
	switch strings.TrimSpace(strings.ToLower(host)) {
	case "rsshub.rssforever.com", "rsshub.app", "www.rsshub.app":
		return true
	default:
		return false
	}
}

func isRSSHubProviderURL(u *url.URL) bool {
	if u == nil {
		return false
	}
	host := strings.TrimSpace(strings.ToLower(u.Hostname()))
	if host == "" {
		return false
	}
	if isRSSHubHost(host) {
		return true
	}
	if !isLocalOrPrivateHost(host) {
		return false
	}
	return looksLikeRSSHubPath(u.Path)
}

func looksLikeRSSHubPath(pathValue string) bool {
	trimmed := strings.Trim(pathValue, "/")
	if trimmed == "" {
		return false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		return false
	}
	first := strings.TrimSpace(strings.ToLower(parts[0]))
	if first == "" || strings.Contains(first, ".") {
		return false
	}
	return true
}

func isLocalOrPrivateHost(host string) bool {
	normalized := strings.TrimSpace(strings.ToLower(host))
	if normalized == "localhost" {
		return true
	}
	ip := net.ParseIP(normalized)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
