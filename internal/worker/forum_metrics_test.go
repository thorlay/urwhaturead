package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"

	"quick/internal/feedextract"
)

type forumMetricsTransport func(*http.Request) (*http.Response, error)

func (f forumMetricsTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func metricsResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestPublicForumMetricsCoalescesDuplicateTopics(t *testing.T) {
	shared := &gofeed.Item{Link: "https://v2ex.com/t/123#reply1"}
	known := &gofeed.Item{Link: "https://v2ex.com/t/123"}
	feedextract.SetForumReplyCount(known, 7)
	feed := &gofeed.Feed{Items: []*gofeed.Item{
		shared, shared, {Link: "https://www.v2ex.com/t/123?p=2"},
		{Link: "https://news.ycombinator.com/item?id=456"},
		{Link: "https://news.ycombinator.com/item?id=456#comments"}, known, nil,
	}}
	var mu sync.Mutex
	requests := map[string]int{}
	worker := NewRSSWorker(nil, RSSWorkerOptions{})
	worker.httpClient.Transport = forumMetricsTransport(func(req *http.Request) (*http.Response, error) {
		mu.Lock()
		requests[req.URL.String()]++
		mu.Unlock()
		if req.URL.Hostname() == "hacker-news.firebaseio.com" {
			return metricsResponse(`{"descendants":0}`), nil
		}
		return metricsResponse(`[{"replies":42}]`), nil
	})
	worker.enrichPublicForumMetrics(context.Background(), feed)
	if len(requests) != 2 {
		t.Fatalf("got %d distinct requests, want 2", len(requests))
	}
	for endpoint, calls := range requests {
		if calls != 1 {
			t.Errorf("%s requested %d times, want 1", endpoint, calls)
		}
	}
	for i, want := range []int{42, 42, 42, 0, 0, 7} {
		got := feedextract.ForumReplyCount(feed.Items[i])
		if got == nil || *got != want {
			t.Errorf("item %d count = %v, want %d", i, got, want)
		}
	}
}

func TestPublicForumMetricsLimitsUniqueRequests(t *testing.T) {
	feed := &gofeed.Feed{}
	for i := 1; i <= 45; i++ {
		feed.Items = append(feed.Items, &gofeed.Item{Link: fmt.Sprintf("https://v2ex.com/t/%d", i)})
	}
	// Duplicates of accepted topics still receive results after the budget fills.
	feed.Items = append(feed.Items, &gofeed.Item{Link: "https://www.v2ex.com/t/1"})
	worker := NewRSSWorker(nil, RSSWorkerOptions{})
	var mu sync.Mutex
	requests := 0
	worker.httpClient.Transport = forumMetricsTransport(func(req *http.Request) (*http.Response, error) {
		mu.Lock()
		requests++
		mu.Unlock()
		return metricsResponse(`[{"replies":12}]`), nil
	})
	worker.enrichPublicForumMetrics(context.Background(), feed)
	if requests != 40 {
		t.Fatalf("got %d requests, want 40", requests)
	}
	for i, item := range feed.Items {
		count := feedextract.ForumReplyCount(item)
		if i >= 40 && i < 45 {
			if count != nil {
				t.Errorf("topic outside budget received count: %d", i)
			}
		} else if count == nil || *count != 12 {
			t.Errorf("accepted topic %d did not receive count", i)
		}
	}
}

func TestPublicForumMetricsFailuresLeaveCountsUnknown(t *testing.T) {
	for _, body := range []string{`[{"replies":-1}]`, `[]`, `[{"title":"no count"}]`, `invalid JSON`} {
		t.Run(body, func(t *testing.T) {
			worker := NewRSSWorker(nil, RSSWorkerOptions{})
			worker.httpClient.Transport = forumMetricsTransport(func(*http.Request) (*http.Response, error) {
				return metricsResponse(body), nil
			})
			feed := &gofeed.Feed{Items: []*gofeed.Item{{Link: "https://v2ex.com/t/123"}, {Link: "https://v2ex.com/t/123"}}}
			worker.enrichPublicForumMetrics(context.Background(), feed)
			for _, item := range feed.Items {
				if got := feedextract.ForumReplyCount(item); got != nil {
					t.Fatalf("failed lookup must keep count unknown, got %d", *got)
				}
			}
		})
	}
}

func TestPublicForumMetricsBoundsConcurrency(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	feed := &gofeed.Feed{}
	for i := 1; i <= 8; i++ {
		feed.Items = append(feed.Items, &gofeed.Item{Link: fmt.Sprintf("https://v2ex.com/t/%d", i)})
	}
	started := make(chan struct{}, len(feed.Items))
	release := make(chan struct{})
	worker := NewRSSWorker(nil, RSSWorkerOptions{})
	worker.httpClient.Transport = forumMetricsTransport(func(req *http.Request) (*http.Response, error) {
		started <- struct{}{}
		select {
		case <-release:
			return metricsResponse(`[{"replies":12}]`), nil
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	})
	done := make(chan struct{})
	go func() {
		worker.enrichPublicForumMetrics(ctx, feed)
		close(done)
	}()
	for i := 0; i < 4; i++ {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("four lookups did not start concurrently")
		}
	}
	select {
	case <-started:
		t.Error("more than four lookups started before an earlier lookup finished")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("lookups did not finish")
	}
	for _, item := range feed.Items {
		if count := feedextract.ForumReplyCount(item); count == nil || *count != 12 {
			t.Fatal("all accepted lookups must eventually receive counts")
		}
	}
}

func TestPublicForumMetricsSkipsCanceledRequests(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	worker := NewRSSWorker(nil, RSSWorkerOptions{})
	var attempts atomic.Int32
	worker.httpClient.Transport = forumMetricsTransport(func(*http.Request) (*http.Response, error) {
		attempts.Add(1)
		return metricsResponse(`[{"replies":12}]`), nil
	})
	feed := &gofeed.Feed{Items: []*gofeed.Item{{Link: "https://v2ex.com/t/123"}}}
	worker.enrichPublicForumMetrics(ctx, feed)
	if attempts.Load() != 0 || feedextract.ForumReplyCount(feed.Items[0]) != nil {
		t.Fatal("a canceled poll must not issue requests or change counts")
	}
}
