package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminAuthLoginAndSession(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	handler := NewAdminAuthHandler(AdminAuthOptions{
		Enabled:  true,
		Token:    "token-123",
		Username: "admin",
		Password: "secret",
		AIModel:  "deepseek-v4-flash",
	})
	handler.RegisterPublicRoutes(engine.Group("/api/v1/admin"))

	loginBody := `{"username":"admin","password":"secret"}`
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/login", bytes.NewBufferString(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRecorder := httptest.NewRecorder()
	engine.ServeHTTP(loginRecorder, loginReq)

	if loginRecorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", loginRecorder.Code, loginRecorder.Body.String())
	}
	setCookie := loginRecorder.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "quick_admin_token=token-123") {
		t.Fatalf("expected quick_admin_token cookie, got %q", setCookie)
	}

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/session", nil)
	sessionReq.Header.Set("Cookie", setCookie)
	sessionRecorder := httptest.NewRecorder()
	engine.ServeHTTP(sessionRecorder, sessionReq)

	if sessionRecorder.Code != http.StatusOK {
		t.Fatalf("expected session status 200, got %d body=%s", sessionRecorder.Code, sessionRecorder.Body.String())
	}

	var payload struct {
		Data struct {
			Enabled       bool   `json:"enabled"`
			Configured    bool   `json:"configured"`
			Authenticated bool   `json:"authenticated"`
			Username      string `json:"username"`
			AIModel       string `json:"ai_model"`
		} `json:"data"`
	}
	if err := json.Unmarshal(sessionRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal session payload: %v", err)
	}
	if !payload.Data.Enabled || !payload.Data.Configured || !payload.Data.Authenticated {
		t.Fatalf("unexpected session payload: %+v", payload.Data)
	}
	if payload.Data.Username != "admin" {
		t.Fatalf("expected username=admin, got %q", payload.Data.Username)
	}
	if payload.Data.AIModel != "deepseek-v4-flash" {
		t.Fatalf("expected ai_model=deepseek-v4-flash, got %q", payload.Data.AIModel)
	}
}

func TestAdminAuthLoginInvalidCredentials(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	handler := NewAdminAuthHandler(AdminAuthOptions{
		Enabled:  true,
		Token:    "token-123",
		Username: "admin",
		Password: "secret",
	})
	handler.RegisterPublicRoutes(engine.Group("/api/v1/admin"))

	loginBody := `{"username":"admin","password":"wrong"}`
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/login", bytes.NewBufferString(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, loginReq)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAdminAuthLoginNotConfigured(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	handler := NewAdminAuthHandler(AdminAuthOptions{
		Enabled:  true,
		Token:    "token-123",
		Username: "admin",
		Password: "",
	})
	handler.RegisterPublicRoutes(engine.Group("/api/v1/admin"))

	loginBody := `{"username":"admin","password":"secret"}`
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/login", bytes.NewBufferString(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, loginReq)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAdminAuthLogoutClearsCookie(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	handler := NewAdminAuthHandler(AdminAuthOptions{
		Enabled:  true,
		Token:    "token-123",
		Username: "admin",
		Password: "secret",
	})
	handler.RegisterPublicRoutes(engine.Group("/api/v1/admin"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/logout", nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	setCookie := recorder.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "quick_admin_token=") || !strings.Contains(setCookie, "Max-Age=0") {
		t.Fatalf("expected cleared cookie, got %q", setCookie)
	}
}
