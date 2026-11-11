package router

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSourceMCPEndpointDisabledByDefault(t *testing.T) {
	for _, key := range []string{"", "a-separate-mcp-key-with-at-least-32-characters"} {
		engine := gin.New()
		RegisterSourceMCP(engine, nil, "", key)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/mcp", nil))
		expected := 401
		if key == "" {
			expected = 404
		}
		if w.Code != expected {
			t.Fatalf("configured=%t status=%d want=%d", key != "", w.Code, expected)
		}
	}
}
