package handlers

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidateProxyImageURLRejectsPrivateHosts(t *testing.T) {
	inputs := []string{
		"http://127.0.0.1:1200/a.png",
		"http://localhost/a.png",
		"http://10.0.0.12/a.png",
		"http://192.168.1.2/a.png",
	}

	for _, input := range inputs {
		parsed, err := url.Parse(input)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", input, err)
		}
		if err := validateProxyImageURL(parsed); err == nil {
			t.Fatalf("validateProxyImageURL(%q) should reject private/local host", input)
		}
	}
}

func TestValidateProxyImageURLRejectsUnsupportedSchemes(t *testing.T) {
	parsed, err := url.Parse("file:///tmp/a.png")
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	if err := validateProxyImageURL(parsed); err == nil || !strings.Contains(err.Error(), "http or https") {
		t.Fatalf("validateProxyImageURL() error=%v, want scheme rejection", err)
	}
}

func TestValidateProxyImageURLAllowsPublicIP(t *testing.T) {
	parsed, err := url.Parse("https://93.184.216.34/image.png")
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	if err := validateProxyImageURL(parsed); err != nil {
		t.Fatalf("validateProxyImageURL() unexpected error: %v", err)
	}
}

func TestImageProxyCacheEvictsLeastRecentlyUsedEntry(t *testing.T) {
	cache := newImageProxyCache(6, 2, 4, time.Hour)
	now := time.Now()
	cache.add("first", proxyImage{body: []byte("111")}, now)
	cache.add("second", proxyImage{body: []byte("222")}, now)
	if _, ok := cache.get("first", now); !ok {
		t.Fatal("first entry should be cached")
	}
	cache.add("third", proxyImage{body: []byte("333")}, now)

	if _, ok := cache.get("second", now); ok {
		t.Fatal("least recently used entry should be evicted")
	}
	if _, ok := cache.get("first", now); !ok {
		t.Fatal("recently used entry should remain cached")
	}
}

func TestImageProxyCacheExpiresAndSkipsLargeEntries(t *testing.T) {
	cache := newImageProxyCache(32, 4, 4, time.Minute)
	now := time.Now()
	if cache.add("large", proxyImage{body: []byte("12345")}, now) {
		t.Fatal("oversized entry should not be cached")
	}
	cache.add("short", proxyImage{body: []byte("1234")}, now)
	if _, ok := cache.get("short", now.Add(time.Minute)); ok {
		t.Fatal("expired entry should not be returned")
	}
}

func TestImageProxyHandlerCoalescesConcurrentFetches(t *testing.T) {
	handler := &ImageProxyHandler{
		cache: newImageProxyCache(1024, 16, 1024, time.Hour),
	}
	var fetches atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	handler.fetch = func(context.Context, string) (proxyImage, error) {
		if fetches.Add(1) == 1 {
			close(started)
		}
		<-release
		return proxyImage{body: []byte("image"), contentType: "image/png"}, nil
	}

	const callers = 12
	var wg sync.WaitGroup
	errors := make(chan error, callers)
	wg.Add(callers)
	for range callers {
		go func() {
			defer wg.Done()
			image, _, err := handler.loadImage(context.Background(), "https://example.com/image.png")
			if err != nil {
				errors <- err
				return
			}
			if string(image.body) != "image" {
				errors <- fmt.Errorf("unexpected image body: %s", image.body)
			}
		}()
	}
	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	if got := fetches.Load(); got != 1 {
		t.Fatalf("fetch count=%d, want 1", got)
	}
}
