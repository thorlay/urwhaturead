package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxProxyImageBytes = 8 << 20

var imageProxyHTTPClient = newPublicHTTPClient(8*time.Second, false)

type ImageProxyHandler struct{}

func NewImageProxyHandler() *ImageProxyHandler {
	return &ImageProxyHandler{}
}

func (h *ImageProxyHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/proxy", h.Proxy)
}

func (h *ImageProxyHandler) Proxy(c *gin.Context) {
	rawURL := strings.TrimSpace(c.Query("url"))
	if rawURL == "" {
		badRequest(c, "url is required")
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		badRequest(c, "invalid image url")
		return
	}
	if err := validateProxyImageURL(parsed); err != nil {
		badRequest(c, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		badRequest(c, "invalid image request")
		return
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/*,*/*;q=0.7")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; QuickImageProxy/0.1; +https://urwhaturead.com/contact)")

	resp, err := imageProxyHTTPClient.Do(req)
	if err != nil {
		badGateway(c, fmt.Sprintf("fetch image failed: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		badGateway(c, fmt.Sprintf("image source returned HTTP %d", resp.StatusCode))
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProxyImageBytes+1))
	if err != nil {
		badGateway(c, "read image failed")
		return
	}
	if len(body) > maxProxyImageBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image is too large"})
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" || !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		contentType = http.DetectContentType(body)
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		badGateway(c, "upstream response is not an image")
		return
	}

	c.Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, int64(len(body)), contentType, bytes.NewReader(body), nil)
}

func validateProxyImageURL(parsed *url.URL) error {
	if err := validatePublicURLSyntax(parsed); err != nil {
		return fmt.Errorf("image %w", err)
	}
	return nil
}
