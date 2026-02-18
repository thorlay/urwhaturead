package handlers

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"quick/internal/models"
	"quick/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/net/publicsuffix"
	"gorm.io/gorm"
)

type SourceHandler struct {
	db         *gorm.DB
	httpClient *http.Client
	refresher  worker.Refresher
}

func NewSourceHandler(db *gorm.DB, refresher worker.Refresher) *SourceHandler {
	return &SourceHandler{
		db: db,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
		refresher: refresher,
	}
}

func (h *SourceHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.GET("/:id", h.Get)
	group.POST("", h.Create)
	group.PATCH("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
	group.POST("/:id/test", h.TestFeed)
	group.POST("/:id/refresh", h.Refresh)
}

type createSourceRequest struct {
	OwnerUserID     *uint64 `json:"owner_user_id"`
	Name            string  `json:"name"`
	RSSURL          string  `json:"rss_url" binding:"required,url"`
	Category        string  `json:"category"`
	Enabled         *bool   `json:"enabled"`
	PollIntervalSec *int    `json:"poll_interval_sec"`
}

type updateSourceRequest struct {
	Name            *string `json:"name"`
	RSSURL          *string `json:"rss_url" binding:"omitempty,url"`
	Category        *string `json:"category"`
	Enabled         *bool   `json:"enabled"`
	PollIntervalSec *int    `json:"poll_interval_sec"`
}

func (h *SourceHandler) List(c *gin.Context) {
	query := h.db.Model(&models.Source{})

	if ownerRaw := c.Query("owner_user_id"); ownerRaw != "" {
		ownerID, err := strconv.ParseUint(ownerRaw, 10, 64)
		if err != nil {
			badRequest(c, "owner_user_id must be an unsigned integer")
			return
		}
		query = query.Where("owner_user_id = ?", ownerID)
	}

	if category := strings.TrimSpace(c.Query("category")); category != "" {
		query = query.Where("category = ?", category)
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
	if err := query.Order("id DESC").Limit(limit).Offset(offset).Find(&sources).Error; err != nil {
		internalServerError(c, "query sources failed", err)
		return
	}
	for i := range sources {
		sources[i].SiteKey = normalizeSiteKey(sources[i].RSSURL)
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
	source.SiteKey = normalizeSiteKey(source.RSSURL)

	c.JSON(http.StatusOK, source)
}

func (h *SourceHandler) Create(c *gin.Context) {
	var req createSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	name := strings.TrimSpace(req.Name)
	rssURL := strings.TrimSpace(req.RSSURL)
	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = "general"
	}

	if name == "" {
		result, err := h.probeFeed(rssURL)
		if err == nil {
			name = strings.TrimSpace(result.Title)
		}
		if name == "" {
			name = fallbackSourceNameFromURL(rssURL)
		}
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
		Category:        category,
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

	c.JSON(http.StatusCreated, source)
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
		rssURL := strings.TrimSpace(*req.RSSURL)
		updates["rss_url"] = rssURL
		updates["site_key"] = normalizeSiteKey(rssURL)
	}
	if req.Category != nil {
		category := strings.TrimSpace(*req.Category)
		if category == "" {
			badRequest(c, "category cannot be empty")
			return
		}
		updates["category"] = category
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
}

func (h *SourceHandler) probeFeed(feedURL string) (*probeResult, error) {
	req, err := http.NewRequest(http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "quick-news-aggregator/0.1")

	resp, err := h.httpClient.Do(req)
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
			Title string `xml:"title"`
			Items []any  `xml:"item"`
		} `xml:"channel"`
		Entries []any `xml:"entry"`
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
	case "feed":
		result.FeedType = "atom"
		result.Title = feed.Title
		result.ItemCount = len(feed.Entries)
	default:
		if len(feed.Channel.Items) > 0 {
			result.FeedType = "rss"
			result.Title = feed.Channel.Title
			result.ItemCount = len(feed.Channel.Items)
		}
	}

	return result, nil
}

func parseUintParam(c *gin.Context, key string) (uint64, error) {
	raw := c.Param(key)
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an unsigned integer", key)
	}
	return value, nil
}

func badRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": message})
}

func notFound(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, gin.H{"error": message})
}

func badGateway(c *gin.Context, message string) {
	c.JSON(http.StatusBadGateway, gin.H{"error": message})
}

func internalServerError(c *gin.Context, message string, err error) {
	c.JSON(http.StatusInternalServerError, gin.H{
		"error":   message,
		"details": err.Error(),
	})
}

func fallbackSourceNameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err == nil {
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
	if host == "rsshub.rssforever.com" {
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
