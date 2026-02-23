package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AdminStatusHandler struct {
	db               *gorm.DB
	backoffMaxFactor int
}

func NewAdminStatusHandler(db *gorm.DB, backoffMaxFactor int) *AdminStatusHandler {
	if backoffMaxFactor < 1 {
		backoffMaxFactor = 16
	}

	return &AdminStatusHandler{
		db:               db,
		backoffMaxFactor: backoffMaxFactor,
	}
}

func (h *AdminStatusHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/source-status", h.ListSourceStatus)
}

type sourceStatusRow struct {
	SourceID            uint64         `gorm:"column:source_id"`
	Name                string         `gorm:"column:name"`
	PrimaryTag          string         `gorm:"column:primary_tag"`
	Enabled             bool           `gorm:"column:enabled"`
	RSSURL              string         `gorm:"column:rss_url"`
	PollIntervalSec     int            `gorm:"column:poll_interval_sec"`
	ConsecutiveFailures int            `gorm:"column:consecutive_failures"`
	LastErrorAt         sql.NullTime   `gorm:"column:last_error_at"`
	LastErrorMessage    sql.NullString `gorm:"column:last_error_message"`
	LastFetchedAt       sql.NullTime   `gorm:"column:last_fetched_at"`
	LatestStatus        sql.NullString
	LatestFetchedAt     sql.NullTime `gorm:"column:latest_fetched_at"`
	LatestHTTPStatus    sql.NullInt64
	LatestItemCount     sql.NullInt64
	LatestDurationMS    sql.NullInt64
	LatestError         sql.NullString
	WindowTotal         int64 `gorm:"column:window_total"`
	WindowSuccess       int64 `gorm:"column:window_success"`
	WindowNotMod        int64 `gorm:"column:window_not_modified"`
	WindowFailed        int64 `gorm:"column:window_failed"`
}

type sourceStatusItem struct {
	SourceID                 uint64     `json:"source_id"`
	Name                     string     `json:"name"`
	PrimaryTag               string     `json:"primary_tag"`
	Enabled                  bool       `json:"enabled"`
	RSSURL                   string     `json:"rss_url"`
	PollIntervalSec          int        `json:"poll_interval_sec"`
	EffectivePollIntervalSec int        `json:"effective_poll_interval_sec"`
	ConsecutiveFailures      int        `json:"consecutive_failures"`
	LastFetchedAt            *time.Time `json:"last_fetched_at,omitempty"`
	LastErrorAt              *time.Time `json:"last_error_at,omitempty"`
	LatestStatus             *string    `json:"latest_status,omitempty"`
	LatestFetchedAt          *time.Time `json:"latest_fetched_at,omitempty"`
	LatestHTTPStatus         *int       `json:"latest_http_status,omitempty"`
	LatestItemCount          *int       `json:"latest_item_count,omitempty"`
	LatestDurationMS         *int       `json:"latest_duration_ms,omitempty"`
	LastError                *string    `json:"last_error,omitempty"`
	NextDueAt                *time.Time `json:"next_due_at,omitempty"`
	IsStale                  bool       `json:"is_stale"`
	WindowHours              int        `json:"window_hours"`
	WindowTotal              int64      `json:"window_total"`
	WindowSuccess            int64      `json:"window_success"`
	WindowNotModified        int64      `json:"window_not_modified"`
	WindowFailed             int64      `json:"window_failed"`
	WindowSuccessRate        float64    `json:"window_success_rate"`
	Health                   string     `json:"health"`
}

func (h *AdminStatusHandler) ListSourceStatus(c *gin.Context) {
	windowHours := 24
	if raw := c.Query("window_hours"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 || value > 168 {
			badRequest(c, "window_hours must be an integer between 1 and 168")
			return
		}
		windowHours = value
	}

	windowStart := time.Now().Add(-time.Duration(windowHours) * time.Hour)

	var rows []sourceStatusRow
	query := `
SELECT
  s.id AS source_id,
  s.name,
  COALESCE(NULLIF(s.tags[1], ''), 'general') AS primary_tag,
  s.enabled,
  s.rss_url,
  s.poll_interval_sec,
  s.consecutive_failures,
  s.last_error_at,
  s.last_error_message,
  s.last_fetched_at,
  latest.status AS latest_status,
  latest.fetched_at AS latest_fetched_at,
  latest.http_status AS latest_http_status,
  latest.item_count AS latest_item_count,
  latest.duration_ms AS latest_duration_ms,
  latest.error_message AS latest_error,
  COALESCE(stats.window_total, 0) AS window_total,
  COALESCE(stats.window_success, 0) AS window_success,
  COALESCE(stats.window_not_modified, 0) AS window_not_modified,
  COALESCE(stats.window_failed, 0) AS window_failed
FROM sources AS s
LEFT JOIN LATERAL (
  SELECT
    l.status,
    l.fetched_at,
    l.http_status,
    l.item_count,
    l.duration_ms,
    l.error_message
  FROM source_fetch_logs AS l
  WHERE l.source_id = s.id
  ORDER BY l.fetched_at DESC, l.id DESC
  LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS window_total,
    COUNT(*) FILTER (WHERE l2.status = 'success') AS window_success,
    COUNT(*) FILTER (WHERE l2.status = 'not_modified') AS window_not_modified,
    COUNT(*) FILTER (WHERE l2.status = 'failed') AS window_failed
  FROM source_fetch_logs AS l2
  WHERE l2.source_id = s.id
    AND l2.fetched_at >= ?
) AS stats ON TRUE
ORDER BY s.enabled DESC, COALESCE(latest.fetched_at, s.created_at) DESC, s.id DESC
`

	if err := h.db.Raw(query, windowStart).Scan(&rows).Error; err != nil {
		internalServerError(c, "query source status failed", err)
		return
	}

	now := time.Now()
	items := make([]sourceStatusItem, 0, len(rows))
	for _, row := range rows {
		item := sourceStatusItem{
			SourceID:                 row.SourceID,
			Name:                     row.Name,
			PrimaryTag:               row.PrimaryTag,
			Enabled:                  row.Enabled,
			RSSURL:                   row.RSSURL,
			PollIntervalSec:          row.PollIntervalSec,
			EffectivePollIntervalSec: row.PollIntervalSec * effectiveBackoffFactor(row.ConsecutiveFailures, h.backoffMaxFactor),
			ConsecutiveFailures:      row.ConsecutiveFailures,
			WindowHours:              windowHours,
			WindowTotal:              row.WindowTotal,
			WindowSuccess:            row.WindowSuccess,
			WindowNotModified:        row.WindowNotMod,
			WindowFailed:             row.WindowFailed,
		}

		if row.LastFetchedAt.Valid {
			value := row.LastFetchedAt.Time
			item.LastFetchedAt = &value

			nextDue := value.Add(time.Duration(item.EffectivePollIntervalSec) * time.Second)
			item.NextDueAt = &nextDue
			item.IsStale = row.Enabled && now.After(nextDue.Add(time.Duration(item.EffectivePollIntervalSec)*time.Second))
		} else {
			item.IsStale = row.Enabled
		}
		if row.LastErrorAt.Valid {
			value := row.LastErrorAt.Time
			item.LastErrorAt = &value
		}
		if row.LastErrorMessage.Valid && row.LastErrorMessage.String != "" {
			value := row.LastErrorMessage.String
			item.LastError = &value
		}

		if row.LatestStatus.Valid {
			value := row.LatestStatus.String
			item.LatestStatus = &value
		}
		if row.LatestFetchedAt.Valid {
			value := row.LatestFetchedAt.Time
			item.LatestFetchedAt = &value
		}
		if row.LatestHTTPStatus.Valid {
			value := int(row.LatestHTTPStatus.Int64)
			item.LatestHTTPStatus = &value
		}
		if row.LatestItemCount.Valid {
			value := int(row.LatestItemCount.Int64)
			item.LatestItemCount = &value
		}
		if row.LatestDurationMS.Valid {
			value := int(row.LatestDurationMS.Int64)
			item.LatestDurationMS = &value
		}
		if item.LastError == nil && row.LatestError.Valid && row.LatestError.String != "" {
			value := row.LatestError.String
			item.LastError = &value
		}

		successLike := row.WindowSuccess + row.WindowNotMod
		if row.WindowTotal > 0 {
			item.WindowSuccessRate = float64(successLike) * 100 / float64(row.WindowTotal)
		}

		item.Health = deriveSourceHealth(item)
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": items,
		"meta": gin.H{
			"window_hours": windowHours,
			"count":        len(items),
			"generated_at": now,
		},
	})
}

func deriveSourceHealth(item sourceStatusItem) string {
	if !item.Enabled {
		return "disabled"
	}
	if item.ConsecutiveFailures >= 3 {
		return "error"
	}
	if item.LatestStatus != nil && *item.LatestStatus == "failed" {
		return "error"
	}
	if item.IsStale {
		return "stale"
	}
	if item.WindowTotal == 0 {
		return "new"
	}
	if item.WindowFailed > 0 {
		return "warn"
	}
	return "ok"
}

func effectiveBackoffFactor(consecutiveFailures int, maxFactor int) int {
	if consecutiveFailures <= 0 || maxFactor <= 1 {
		return 1
	}

	factor := 1
	for i := 0; i < consecutiveFailures; i++ {
		if factor >= maxFactor {
			return maxFactor
		}
		factor *= 2
		if factor > maxFactor {
			return maxFactor
		}
	}
	return factor
}
