package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"quick/internal/models"

	"github.com/gin-gonic/gin"
)

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
