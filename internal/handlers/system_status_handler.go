package handlers

import (
	"context"
	"errors"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"quick/internal/aisummary"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SystemStatusHandler struct {
	db            *gorm.DB
	summarizer    *aisummary.Client
	rsshubBaseURL string
	startedAt     time.Time
	version       string
	httpClient    *http.Client
}

type SystemStatusOptions struct {
	RSSHubBaseURL string
	StartedAt     time.Time
	Version       string
}

type systemComponentStatus struct {
	Status    string `json:"status"`
	Detail    string `json:"detail,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
}

type systemStatusResponse struct {
	API       systemComponentStatus `json:"api"`
	DB        systemComponentStatus `json:"db"`
	RSSHub    systemComponentStatus `json:"rsshub"`
	AI        systemComponentStatus `json:"ai"`
	Version   string                `json:"version"`
	UptimeSec int64                 `json:"uptime_sec"`
	CheckedAt time.Time             `json:"checked_at"`
}

func NewSystemStatusHandler(db *gorm.DB, summarizer *aisummary.Client, options SystemStatusOptions) *SystemStatusHandler {
	startedAt := options.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now().UTC()
	}
	return &SystemStatusHandler{
		db:            db,
		summarizer:    summarizer,
		rsshubBaseURL: strings.TrimRight(strings.TrimSpace(options.RSSHubBaseURL), "/"),
		startedAt:     startedAt,
		version:       firstNonEmpty(strings.TrimSpace(options.Version), detectAppVersion()),
		httpClient: &http.Client{
			Timeout: 4 * time.Second,
		},
	}
}

func (h *SystemStatusHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/status", h.Status)
}

func (h *SystemStatusHandler) Status(c *gin.Context) {
	now := time.Now().UTC()
	response := systemStatusResponse{
		API: systemComponentStatus{
			Status: "ok",
			Detail: "serving",
		},
		DB:        h.checkDB(c.Request.Context()),
		RSSHub:    h.checkRSSHub(c.Request.Context()),
		AI:        h.checkAI(c.Request.Context()),
		Version:   h.version,
		UptimeSec: int64(now.Sub(h.startedAt).Seconds()),
		CheckedAt: now,
	}
	c.JSON(http.StatusOK, gin.H{"data": response})
}

func (h *SystemStatusHandler) checkDB(parent context.Context) systemComponentStatus {
	startedAt := time.Now()
	if h.db == nil {
		return systemComponentStatus{Status: "error", Detail: "database handle is nil"}
	}
	sqlDB, err := h.db.DB()
	if err != nil {
		return systemComponentStatus{Status: "error", Detail: err.Error()}
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return systemComponentStatus{Status: "error", Detail: err.Error(), LatencyMS: time.Since(startedAt).Milliseconds()}
	}
	return systemComponentStatus{Status: "ok", Detail: "ping ok", LatencyMS: time.Since(startedAt).Milliseconds()}
}

func (h *SystemStatusHandler) checkRSSHub(parent context.Context) systemComponentStatus {
	if h.rsshubBaseURL == "" {
		return systemComponentStatus{Status: "disabled", Detail: "RSSHUB_BASE_URL is empty"}
	}
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(parent, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.rsshubBaseURL+"/healthz", nil)
	if err != nil {
		return systemComponentStatus{Status: "error", Detail: err.Error()}
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return systemComponentStatus{Status: "error", Detail: err.Error(), LatencyMS: time.Since(startedAt).Milliseconds()}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return systemComponentStatus{
			Status:    "error",
			Detail:    resp.Status,
			LatencyMS: time.Since(startedAt).Milliseconds(),
		}
	}
	return systemComponentStatus{Status: "ok", Detail: resp.Status, LatencyMS: time.Since(startedAt).Milliseconds()}
}

func (h *SystemStatusHandler) checkAI(parent context.Context) systemComponentStatus {
	if h.summarizer == nil {
		return systemComponentStatus{Status: "disabled", Detail: "AI summary client is not configured"}
	}
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	if err := h.summarizer.Probe(ctx); err != nil {
		status := "error"
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
			status = "warn"
		}
		return systemComponentStatus{Status: status, Detail: err.Error(), LatencyMS: time.Since(startedAt).Milliseconds()}
	}
	return systemComponentStatus{Status: "ok", Detail: "probe ok", LatencyMS: time.Since(startedAt).Milliseconds()}
}

func detectAppVersion() string {
	for _, key := range []string{"APP_VERSION", "GIT_COMMIT", "RENDER_GIT_COMMIT"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return shortVersion(value)
		}
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	for _, setting := range info.Settings {
		if setting.Key == "vcs.revision" && strings.TrimSpace(setting.Value) != "" {
			return shortVersion(setting.Value)
		}
	}
	if strings.TrimSpace(info.Main.Version) != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "dev"
}

func shortVersion(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 12 {
		return value[:12]
	}
	return value
}
