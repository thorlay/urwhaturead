package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"quick/internal/feedextract"
	"quick/internal/textclean"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

const (
	maxFeedSummaryRunes = 400
	maxFeedContentRunes = 320
)

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

func (h *FeedHandler) List(c *gin.Context) {
	startedAt := time.Now()
	params, err := parseFeedListParams(c)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	result, queryErr := h.feedRepository.list(c.Request.Context(), params)
	if queryErr != nil {
		internalServerError(c, queryErr.message, queryErr.cause)
		return
	}

	nextCursor := ""
	if len(result.rows) > params.limit {
		last := result.rows[params.limit-1]
		nextCursor = encodeFeedCursor(feedCursor{SortTime: last.SortTime, ID: last.ID})
		result.rows = result.rows[:params.limit]
	}
	sanitizeStartedAt := time.Now()
	sanitizeFeedItems(result.rows)
	sanitizeElapsed := time.Since(sanitizeStartedAt)

	meta := gin.H{
		"limit":                  params.limit,
		"count":                  len(result.rows),
		"next_cursor":            nextCursor,
		"elapsed_ms":             time.Since(startedAt).Milliseconds(),
		"query_ms":               result.queryElapsed.Milliseconds(),
		"sanitize_ms":            sanitizeElapsed.Milliseconds(),
		"dedupe":                 params.dedupe,
		"dedupe_candidate_limit": result.dedupeCandidateLimit,
	}
	if params.since != nil {
		meta["since"] = params.since.Format(time.RFC3339)
		meta["total_count"] = result.totalCount
	}
	c.JSON(http.StatusOK, gin.H{"data": result.rows, "meta": meta})
}

func parseFeedListParams(c *gin.Context) (feedListParams, error) {
	params := feedListParams{limit: 20}
	if limitRaw := c.Query("limit"); limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 || value > 100 {
			return params, fmt.Errorf("limit must be an integer between 1 and 100")
		}
		params.limit = value
	}

	params.dedupe = parseFeedDedupeQuery(c.Query("dedupe"))
	params.includeHidden = parseBoolQuery(strings.TrimSpace(c.Query("include_hidden")))
	params.tag = normalizeSourceTag(c.Query("tag"))
	params.keyword = strings.TrimSpace(c.Query("q"))

	var err error
	params.since, err = parseFeedSince(c.Query("since"))
	if err != nil {
		return params, err
	}
	if sourceIDsRaw := strings.TrimSpace(c.Query("source_ids")); sourceIDsRaw != "" {
		params.sourceIDs, err = parseCSVUint64(sourceIDsRaw)
		if err != nil {
			return params, err
		}
	}
	if cursorRaw := strings.TrimSpace(c.Query("cursor")); cursorRaw != "" {
		cursor, err := decodeFeedCursor(cursorRaw)
		if err != nil {
			return params, fmt.Errorf("invalid cursor")
		}
		params.cursor = &cursor
	}
	return params, nil
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

func parseFeedDedupeQuery(raw string) bool {
	raw = strings.TrimSpace(raw)
	return raw != "" && parseBoolQuery(raw)
}

func parseFeedSince(raw string) (*time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("since must be an RFC3339 timestamp")
	}
	parsed = parsed.UTC()
	return &parsed, nil
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
				value = truncateFeedText(value, maxFeedSummaryRunes)
				item.Summary = &value
			}
		}
		if item.Content != nil {
			value := textclean.NormalizeFromHTML(*item.Content)
			if value == "" {
				item.Content = nil
			} else {
				value = truncateFeedText(value, maxFeedContentRunes)
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

func truncateFeedText(value string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "..."
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
