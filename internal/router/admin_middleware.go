package router

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func RequireAdminToken(token string) gin.HandlerFunc {
	trimmedToken := strings.TrimSpace(token)

	return func(c *gin.Context) {
		if trimmedToken == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "admin auth is enabled but ADMIN_TOKEN is empty",
			})
			return
		}

		candidate := strings.TrimSpace(c.GetHeader("X-Admin-Token"))
		if candidate == "" {
			candidate = parseBearerToken(c.GetHeader("Authorization"))
		}
		if candidate == "" {
			candidate, _ = c.Cookie("quick_admin_token")
			candidate = strings.TrimSpace(candidate)
		}

		if subtle.ConstantTimeCompare([]byte(candidate), []byte(trimmedToken)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "admin authentication required",
			})
			return
		}

		c.Next()
	}
}

func parseBearerToken(raw string) string {
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
