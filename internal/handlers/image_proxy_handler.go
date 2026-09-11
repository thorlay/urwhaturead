package handlers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/singleflight"
)

const (
	maxProxyImageBytes       = 8 << 20
	maxCachedImageBytes      = 2 << 20
	maxImageCacheBytes       = 32 << 20
	maxImageCacheEntries     = 256
	imageProxyCacheTTL       = 24 * time.Hour
	imageProxyRequestTimeout = 8 * time.Second
)

var imageProxyHTTPClient = newPublicHTTPClient(8*time.Second, false)

type ImageProxyHandler struct {
	cache    *imageProxyCache
	requests singleflight.Group
	fetch    func(context.Context, string) (proxyImage, error)
}

func NewImageProxyHandler() *ImageProxyHandler {
	handler := &ImageProxyHandler{
		cache: newImageProxyCache(
			maxImageCacheBytes,
			maxImageCacheEntries,
			maxCachedImageBytes,
			imageProxyCacheTTL,
		),
	}
	handler.fetch = handler.fetchImage
	return handler
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

	image, cacheStatus, err := h.loadImage(c.Request.Context(), parsed.String())
	if err != nil {
		if errors.Is(err, errProxyImageTooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error()})
			return
		}
		badGateway(c, err.Error())
		return
	}

	c.Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
	c.Header("Content-Type", image.contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Image-Cache", cacheStatus)
	c.DataFromReader(http.StatusOK, int64(len(image.body)), image.contentType, bytes.NewReader(image.body), nil)
}

var errProxyImageTooLarge = errors.New("image is too large")

func (h *ImageProxyHandler) loadImage(ctx context.Context, rawURL string) (proxyImage, string, error) {
	if image, ok := h.cache.get(rawURL, time.Now()); ok {
		return image, "hit", nil
	}

	result := h.requests.DoChan(rawURL, func() (any, error) {
		if image, ok := h.cache.get(rawURL, time.Now()); ok {
			return image, nil
		}
		fetchCtx, cancel := context.WithTimeout(context.Background(), imageProxyRequestTimeout)
		defer cancel()
		image, err := h.fetch(fetchCtx, rawURL)
		if err == nil {
			h.cache.add(rawURL, image, time.Now())
		}
		return image, err
	})

	select {
	case <-ctx.Done():
		return proxyImage{}, "miss", ctx.Err()
	case loaded := <-result:
		if loaded.Err != nil {
			return proxyImage{}, "miss", loaded.Err
		}
		if loaded.Shared {
			return loaded.Val.(proxyImage), "shared", nil
		}
		return loaded.Val.(proxyImage), "miss", nil
	}
}

func (h *ImageProxyHandler) fetchImage(ctx context.Context, rawURL string) (proxyImage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return proxyImage{}, fmt.Errorf("invalid image request")
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/*,*/*;q=0.7")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; QuickImageProxy/0.1; +https://urwhaturead.com/contact)")

	resp, err := imageProxyHTTPClient.Do(req)
	if err != nil {
		return proxyImage{}, fmt.Errorf("fetch image failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return proxyImage{}, fmt.Errorf("image source returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProxyImageBytes+1))
	if err != nil {
		return proxyImage{}, fmt.Errorf("read image failed: %w", err)
	}
	if len(body) > maxProxyImageBytes {
		return proxyImage{}, errProxyImageTooLarge
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" || !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		contentType = http.DetectContentType(body)
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		return proxyImage{}, fmt.Errorf("upstream response is not an image")
	}
	return proxyImage{body: body, contentType: contentType}, nil
}

func validateProxyImageURL(parsed *url.URL) error {
	if err := validatePublicURLSyntax(parsed); err != nil {
		return fmt.Errorf("image %w", err)
	}
	return nil
}
