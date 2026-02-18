package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FeedHandler struct {
	db *gorm.DB
}

func NewFeedHandler(db *gorm.DB) *FeedHandler {
	return &FeedHandler{db: db}
}

func (h *FeedHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
}

type feedItem struct {
	ID             uint64     `json:"id"`
	SourceID       uint64     `json:"source_id"`
	SourceName     string     `json:"source_name"`
	SourceCategory string     `json:"source_category"`
	Title          string     `json:"title"`
	Link           string     `json:"link"`
	Summary        *string    `json:"summary,omitempty"`
	Author         *string    `json:"author,omitempty"`
	PublishedAt    *time.Time `json:"published_at,omitempty"`
	ImageURL       *string    `json:"image_url,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	SortTime       time.Time  `json:"-"`
}

type feedCursor struct {
	SortTime time.Time
	ID       uint64
}

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

	query := h.db.
		Table("articles AS a").
		Select(`
			a.id,
			a.source_id,
			s.name AS source_name,
			s.category AS source_category,
			a.title,
			a.link,
			a.summary,
			a.author,
			a.published_at,
			a.image_url,
			a.created_at,
			COALESCE(a.published_at, a.created_at) AS sort_time
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id")

	if category := strings.TrimSpace(c.Query("category")); category != "" {
		query = query.Where("s.category = ?", category)
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
	if err := query.
		Order("COALESCE(a.published_at, a.created_at) DESC").
		Order("a.id DESC").
		Limit(limit + 1).
		Scan(&rows).Error; err != nil {
		internalServerError(c, "query feed failed", err)
		return
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

	c.JSON(http.StatusOK, gin.H{
		"data": rows,
		"meta": gin.H{
			"limit":       limit,
			"count":       len(rows),
			"next_cursor": nextCursor,
		},
	})
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
