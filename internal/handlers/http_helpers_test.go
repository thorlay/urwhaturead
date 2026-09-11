package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInternalServerErrorHidesDetailsAndReturnsRequestID(t *testing.T) {
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Set("request_id", "request-123")

	internalServerError(c, "query failed", errors.New("password=do-not-expose"))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d, want %d", response.Code, http.StatusInternalServerError)
	}
	body := response.Body.String()
	if strings.Contains(body, "do-not-expose") || strings.Contains(body, "details") {
		t.Fatalf("response exposed internal details: %s", body)
	}
	if !strings.Contains(body, `"request_id":"request-123"`) {
		t.Fatalf("response missing request id: %s", body)
	}
}
