package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestV2EXConfiguredHubAndFailureCache(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/rss/v2ex/post/1240051" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	s := NewArticleContentService(ArticleHandlerOptions{RSSHubBaseURL: server.URL + "/rss/"})
	for i := 0; i < 2; i++ {
		if _, ok := s.fetchThreadForTopic(context.Background(), "https://www.v2ex.com/t/1240051"); ok {
			t.Fatal("expected failure")
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("requests=%d, want 1", requests.Load())
	}
	s.cacheMu.Lock()
	s.threadFailures[server.URL+"/rss/v2ex/post/1240051"] = time.Now().Add(-time.Second)
	s.cacheMu.Unlock()
	s.fetchThreadForTopic(context.Background(), "https://www.v2ex.com/t/1240051")
	if requests.Load() != 2 {
		t.Fatal("expired failure should retry")
	}
}

func TestV2EXSuccessfulThreadCached(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, `<rss version="2.0"><channel><title>Topic</title><link>https://www.v2ex.com/t/1240051</link><description>Topic</description><item><title>Post</title><link>https://www.v2ex.com/t/1240051#reply0</link><description>Body</description></item></channel></rss>`)
	}))
	defer server.Close()
	s := NewArticleContentService(ArticleHandlerOptions{RSSHubBaseURL: server.URL})
	for i := 0; i < 2; i++ {
		if _, ok := s.fetchThreadForTopic(context.Background(), "https://www.v2ex.com/t/1240051"); !ok {
			t.Fatal("expected thread")
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("requests=%d, want 1", requests.Load())
	}
}

func TestNewArticleContentService_RedditClientDisablesHTTP2(t *testing.T) {
	service := NewArticleContentService(ArticleHandlerOptions{})
	transport, ok := service.redditHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("reddit transport type=%T, want *http.Transport", service.redditHTTPClient.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("expected reddit transport ForceAttemptHTTP2=false")
	}
	if transport.TLSNextProto == nil {
		t.Fatalf("expected reddit transport TLSNextProto to disable http/2")
	}
}
