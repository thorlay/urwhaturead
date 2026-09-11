package router

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestIDPreservesValidIncomingValue(t *testing.T) {
	engine := gin.New()
	engine.Use(RequestID())
	engine.GET("/test", func(c *gin.Context) {
		value, _ := c.Get(requestIDKey)
		c.String(http.StatusOK, stringValue(value))
	})

	request := httptest.NewRequest(http.MethodGet, "/test", nil)
	request.Header.Set(requestIDHeader, "edge-123.test")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	if got := response.Header().Get(requestIDHeader); got != "edge-123.test" {
		t.Fatalf("response request id=%q, want edge-123.test", got)
	}
	if got := response.Body.String(); got != "edge-123.test" {
		t.Fatalf("context request id=%q, want edge-123.test", got)
	}
}

func TestRequestIDReplacesUnsafeIncomingValue(t *testing.T) {
	engine := gin.New()
	engine.Use(RequestID())
	engine.GET("/test", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/test", nil)
	request.Header.Set(requestIDHeader, "unsafe value")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	got := response.Header().Get(requestIDHeader)
	if len(got) != 32 {
		t.Fatalf("generated request id length=%d, want 32: %q", len(got), got)
	}
	if _, err := hex.DecodeString(got); err != nil {
		t.Fatalf("generated request id is not hex: %q", got)
	}
}

func TestRequestLoggerWritesStructuredRecord(t *testing.T) {
	var output bytes.Buffer
	engine := gin.New()
	engine.Use(RequestID(), RequestLogger(&output))
	engine.GET("/items/:id", func(c *gin.Context) { c.String(http.StatusCreated, "ok") })

	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/items/42?secret=omitted", nil))

	var record accessLogRecord
	if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &record); err != nil {
		t.Fatalf("decode access log: %v; output=%q", err, output.String())
	}
	if record.RequestID == "" || record.Method != http.MethodGet || record.Path != "/items/42" {
		t.Fatalf("unexpected access log: %+v", record)
	}
	if record.Route != "/items/:id" || record.Status != http.StatusCreated || record.Bytes != 2 {
		t.Fatalf("unexpected route response fields: %+v", record)
	}
	if bytes.Contains(output.Bytes(), []byte("secret")) {
		t.Fatalf("access log must not include query strings: %s", output.String())
	}
}
