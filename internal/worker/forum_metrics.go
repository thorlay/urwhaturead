package worker

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
	"quick/internal/feedextract"
)

// Use public topic metadata where RSSHub omits counts. Bound network work per poll.
func (w *RSSWorker) enrichPublicForumMetrics(ctx context.Context, feed *gofeed.Feed) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	type lookup struct {
		endpoint string
		hn       bool
		items    []*gofeed.Item
	}
	lookups := make([]*lookup, 0, 40)
	byEndpoint := make(map[string]*lookup)
	// Collect before starting requests so duplicate item pointers are never read
	// while another goroutine writes their extensions.
	for _, item := range feed.Items {
		if item == nil {
			continue
		}
		if feedextract.ForumReplyCount(item) != nil {
			continue
		}
		u, err := url.Parse(item.Link)
		if err != nil {
			continue
		}
		endpoint := ""
		hn := false
		switch u.Hostname() {
		case "v2ex.com", "www.v2ex.com":
			id := strings.TrimPrefix(u.Path, "/t/")
			id = strings.Split(id, "/")[0]
			if _, err := strconv.ParseUint(id, 10, 64); err == nil {
				endpoint = "https://www.v2ex.com/api/topics/show.json?id=" + id
			}
		case "news.ycombinator.com":
			id := u.Query().Get("id")
			if _, err := strconv.ParseUint(id, 10, 64); err == nil {
				endpoint = "https://hacker-news.firebaseio.com/v0/item/" + id + ".json"
				hn = true
			}
		}
		if endpoint == "" {
			continue
		}
		if existing := byEndpoint[endpoint]; existing != nil {
			existing.items = append(existing.items, item)
			continue
		}
		if len(lookups) >= 40 {
			continue
		}
		job := &lookup{endpoint: endpoint, hn: hn, items: []*gofeed.Item{item}}
		byEndpoint[endpoint] = job
		lookups = append(lookups, job)
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for _, job := range lookups {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			if ctx.Err() != nil {
				return
			}
			req, err := http.NewRequestWithContext(ctx, "GET", job.endpoint, nil)
			if err != nil {
				return
			}
			resp, err := w.httpClient.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				return
			}
			decoder := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024))
			var count *int
			if job.hn {
				var data struct {
					Descendants *int `json:"descendants"`
				}
				if decoder.Decode(&data) == nil && data.Descendants != nil && *data.Descendants >= 0 {
					count = data.Descendants
				}
			} else {
				var data []struct {
					Replies *int `json:"replies"`
				}
				if decoder.Decode(&data) == nil && len(data) > 0 && data[0].Replies != nil && *data[0].Replies >= 0 {
					count = data[0].Replies
				}
			}
			if count != nil {
				for _, item := range job.items {
					feedextract.SetForumReplyCount(item, *count)
				}
			}
		}()
	}
	wg.Wait()
}
