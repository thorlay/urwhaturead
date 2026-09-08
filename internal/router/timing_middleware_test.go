package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestRequestTimingAddsHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(RequestTiming())
	engine.GET("/test", func(c *gin.Context) {
		time.Sleep(time.Millisecond)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/test", nil)
	engine.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if value := response.Header().Get("Server-Timing"); !strings.HasPrefix(value, "app;dur=") {
		t.Fatalf("Server-Timing = %q", value)
	}
	if value := response.Header().Get("Timing-Allow-Origin"); value != "*" {
		t.Fatalf("Timing-Allow-Origin = %q, want *", value)
	}
}
