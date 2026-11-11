package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/models"
)

const testMCPKey = "mcp-test-key-012345678901234567890123456789"

func mcpRequest(t *testing.T, h http.Handler, key, method string, params any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://localhost/api/v1/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestSourceMCPAuthAndTools(t *testing.T) {
	h := NewSourceMCPHandler(nil, "http://127.0.0.1:1200", testMCPKey)
	for _, key := range []string{"", "admin-token", "wrong"} {
		if got := mcpRequest(t, h, key, "tools/list", map[string]any{}).Code; got != 401 {
			t.Fatalf("unauthorized status=%d", got)
		}
	}
	w := mcpRequest(t, h, testMCPKey, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"}})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "serverInfo") {
		t.Fatalf("initialize: %d %s", w.Code, w.Body.String())
	}
	w = mcpRequest(t, h, testMCPKey, "tools/list", map[string]any{})
	var response struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Result.Tools) != 3 {
		t.Fatalf("unexpected tools: %s", w.Body.String())
	}
	for _, name := range []string{"list_sources", "probe_feed", "add_source"} {
		if !strings.Contains(w.Body.String(), `"name":"`+name+`"`) {
			t.Fatalf("missing %s", name)
		}
	}
	for _, name := range []string{"delete_source", "refresh_all", "add_source"} {
		w = mcpRequest(t, h, testMCPKey, "tools/call", map[string]any{"name": name, "arguments": map[string]any{"rss_url": "https://example.com/rss", "confirmed": false}})
		if !strings.Contains(w.Body.String(), `"error"`) && !strings.Contains(w.Body.String(), `"isError":true`) {
			t.Fatalf("unsafe call succeeded: %s", w.Body.String())
		}
	}
}

func TestSourceMCPOriginAndRateLimit(t *testing.T) {
	h := NewSourceMCPHandler(nil, "", testMCPKey)
	req := httptest.NewRequest("POST", "http://localhost/api/v1/mcp", nil)
	req.Header.Set("Authorization", "Bearer "+testMCPKey)
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("origin status=%d", w.Code)
	}
	for i := 0; i < 60; i++ {
		mcpRequest(t, h, testMCPKey, "tools/list", map[string]any{})
	}
	if got := mcpRequest(t, h, testMCPKey, "tools/list", map[string]any{}).Code; got != 429 {
		t.Fatalf("rate limit status=%d", got)
	}
}

func TestSourceMCPBehindLocalReverseProxy(t *testing.T) {
	h := NewSourceMCPHandler(nil, "", testMCPKey)
	req := httptest.NewRequest("POST", "https://urwhaturead.com/api/v1/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Authorization", "Bearer "+testMCPKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("reverse proxy: %d %s", w.Code, w.Body.String())
	}
}

func TestSourceMCPBlocksPrivateTargets(t *testing.T) {
	service := sourceMCP{sources: NewSourceHandlerWithOptions(nil, nil, SourceHandlerOptions{RSSHubBaseURL: "http://127.0.0.1:1200"})}
	for _, raw := range []string{"http://127.0.0.1:8080/healthz", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/rss", "file:///etc/passwd", "http://user:pass@example.com/rss"} {
		if _, err := service.resolveURL(context.Background(), raw); err == nil {
			t.Fatalf("allowed %s", raw)
		}
	}
	if got, err := service.resolveURL(context.Background(), "rsshub://v2ex/topics/hot"); err != nil || got != "http://127.0.0.1:1200/v2ex/topics/hot" {
		t.Fatalf("alias=%q err=%v", got, err)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "http://127.0.0.1:1/private", 302) }))
	defer redirect.Close()
	if _, err := mcpFeedClient(redirect.URL, false).Get(redirect.URL + "/feed"); err == nil {
		t.Fatal("private redirect allowed")
	}
}

func TestSourceMCPPersistence(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	defer conn.Close()
	schema := fmt.Sprintf("mcp_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	scoped, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	scopedConn, _ := scoped.DB()
	defer scopedConn.Close()
	if err := scoped.AutoMigrate(&models.Source{}); err != nil {
		t.Fatal(err)
	}
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/invalid" {
			fmt.Fprint(w, "<html><body>not a feed</body></html>")
			return
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, `<rss version="2.0"><channel><title>MCP Test Feed</title><item><title>Example article</title><description>A useful sample</description></item></channel></rss>`)
	}))
	defer feed.Close()
	h := NewSourceMCPHandler(scoped, feed.URL, testMCPKey)
	call := func(name string, args any) string {
		w := mcpRequest(t, h, testMCPKey, "tools/call", map[string]any{"name": name, "arguments": args})
		if w.Code != 200 || strings.Contains(w.Body.String(), `"isError":true`) || strings.Contains(w.Body.String(), `"error"`) {
			t.Fatalf("%s: %d %s", name, w.Code, w.Body.String())
		}
		return w.Body.String()
	}
	call("probe_feed", map[string]any{"rss_url": "rsshub://test/feed"})
	invalid := mcpRequest(t, h, testMCPKey, "tools/call", map[string]any{"name": "add_source", "arguments": map[string]any{"rss_url": feed.URL + "/invalid", "confirmed": true}})
	if !strings.Contains(invalid.Body.String(), `"isError":true`) {
		t.Fatal("non-feed was accepted")
	}
	var count int64
	scoped.Model(&models.Source{}).Count(&count)
	if count != 0 {
		t.Fatal("probe wrote a subscription")
	}
	call("add_source", map[string]any{"rss_url": "rsshub://test/feed", "confirmed": true, "tags": []string{"tech"}})
	duplicate := call("add_source", map[string]any{"rss_url": feed.URL + "/test/feed", "confirmed": true})
	if !strings.Contains(duplicate, `"already_exists":true`) {
		t.Fatalf("duplicate: %s", duplicate)
	}
	scoped.Model(&models.Source{}).Count(&count)
	if count != 1 {
		t.Fatalf("sources=%d", count)
	}
	var source models.Source
	scoped.First(&source)
	if source.Name != "MCP Test Feed" || source.AIBriefingEnabled || source.OwnerUserID != nil {
		t.Fatalf("unexpected defaults: %+v", source)
	}
	if !strings.Contains(call("list_sources", map[string]any{"query": "MCP Test"}), "MCP Test Feed") {
		t.Fatal("source not listed")
	}
}
