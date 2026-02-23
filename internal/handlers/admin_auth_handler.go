package handlers

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	adminCookieName        = "quick_admin_token"
	defaultAdminSessionTTL = 7 * 24 * time.Hour
)

type AdminAuthOptions struct {
	Enabled  bool
	Token    string
	Username string
	Password string
}

type AdminAuthHandler struct {
	enabled  bool
	token    string
	username string
	password string
	ttl      time.Duration
}

type adminLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func NewAdminAuthHandler(options AdminAuthOptions) *AdminAuthHandler {
	return &AdminAuthHandler{
		enabled:  options.Enabled,
		token:    strings.TrimSpace(options.Token),
		username: strings.TrimSpace(options.Username),
		password: strings.TrimSpace(options.Password),
		ttl:      defaultAdminSessionTTL,
	}
}

func (h *AdminAuthHandler) RegisterPublicRoutes(group *gin.RouterGroup) {
	group.POST("/login", h.Login)
	group.POST("/logout", h.Logout)
	group.GET("/session", h.Session)
}

func (h *AdminAuthHandler) Login(c *gin.Context) {
	if !h.enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "admin auth is disabled",
		})
		return
	}
	if !h.isConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "admin login is not configured; set ADMIN_TOKEN, ADMIN_USERNAME and ADMIN_PASSWORD",
		})
		return
	}

	var req adminLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid request body")
		return
	}
	if !secureEqual(h.username, req.Username) || !secureEqual(h.password, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "invalid username or password",
		})
		return
	}

	setAdminCookie(c, h.token, h.ttl)
	c.JSON(http.StatusOK, gin.H{
		"ok":             true,
		"username":       h.username,
		"expires_in_sec": int(h.ttl.Seconds()),
	})
}

func (h *AdminAuthHandler) Logout(c *gin.Context) {
	clearAdminCookie(c)
	c.JSON(http.StatusOK, gin.H{
		"ok": true,
	})
}

func (h *AdminAuthHandler) Session(c *gin.Context) {
	enabled := h.enabled
	configured := h.isConfigured()
	authenticated := configured && h.isAuthorizedRequest(c)

	payload := gin.H{
		"enabled":       enabled,
		"configured":    configured,
		"authenticated": authenticated,
	}
	if authenticated {
		payload["username"] = h.username
	}

	c.JSON(http.StatusOK, gin.H{
		"data": payload,
	})
}

func (h *AdminAuthHandler) isConfigured() bool {
	return h.token != "" && h.username != "" && h.password != ""
}

func (h *AdminAuthHandler) isAuthorizedRequest(c *gin.Context) bool {
	if h.token == "" {
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
	return secureEqual(h.token, candidate)
}

func secureEqual(expected, actual string) bool {
	expected = strings.TrimSpace(expected)
	actual = strings.TrimSpace(actual)
	if expected == "" || actual == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func parseBearerTokenFromHeader(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	parts := strings.SplitN(value, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(strings.TrimSpace(parts[0]), "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func setAdminCookie(c *gin.Context, token string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = defaultAdminSessionTTL
	}
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     adminCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ttl.Seconds()),
	})
}

func clearAdminCookie(c *gin.Context) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     adminCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}
