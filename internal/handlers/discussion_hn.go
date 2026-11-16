package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type hnDiscussionPost struct {
	ID          uint64   `json:"id"`
	By          string   `json:"by"`
	Text        string   `json:"text"`
	Kids        []uint64 `json:"kids"`
	Parent      uint64   `json:"parent"`
	Descendants *int     `json:"descendants"`
	Time        int64    `json:"time"`
	Deleted     bool     `json:"deleted"`
	Dead        bool     `json:"dead"`
}

// HN's RSS article feeds often contain only a link/abstract. Fetch a bounded
// root-and-child reply sample from HN's official public API, never the linked article.
func fetchHNDiscussion(ctx context.Context, tid string) ([]articleThreadComment, *int, string, error) {
	return fetchHNDiscussionFrom(ctx, tid, "https://hacker-news.firebaseio.com/v0/item/", &http.Client{Timeout: 8 * time.Second})
}
func fetchHNDiscussionFrom(ctx context.Context, tid, base string, client *http.Client) ([]articleThreadComment, *int, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	get := func(id string) (hnDiscussionPost, error) {
		var p hnDiscussionPost
		req, err := http.NewRequestWithContext(ctx, "GET", base+id+".json", nil)
		if err != nil {
			return p, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return p, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return p, fmt.Errorf("HN reply interface returned %d", resp.StatusCode)
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 256*1024)).Decode(&p)
		return p, err
	}
	root, err := get(tid)
	if err != nil {
		return nil, nil, "", err
	}
	if strconv.FormatUint(root.ID, 10) != tid {
		return nil, nil, "", fmt.Errorf("HN 返回的主题与请求不一致")
	}
	limit := len(root.Kids)
	if limit > 12 {
		limit = 12
	}
	blocks := make([][]articleThreadComment, limit)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, kid := range root.Kids[:limit] {
		wg.Add(1)
		go func(i int, id uint64) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			p, e := get(strconv.FormatUint(id, 10))
			if e != nil || p.Deleted || p.Dead || p.Parent != root.ID {
				return
			}
			appendPost := func(post hnDiscussionPost) {
				if post.Deleted || post.Dead || post.Text == "" {
					return
				}
				var at *time.Time
				if post.Time > 0 {
					value := time.Unix(post.Time, 0).UTC()
					at = &value
				}
				blocks[i] = append(blocks[i], articleThreadComment{Author: post.By, Content: post.Text, PublishedAt: at, Link: "https://news.ycombinator.com/item?id=" + strconv.FormatUint(post.ID, 10)})
			}
			appendPost(p)
			if len(p.Kids) > 0 {
				child, e := get(strconv.FormatUint(p.Kids[0], 10))
				if e == nil && child.Parent == p.ID {
					appendPost(child)
				}
			}
		}(i, kid)
	}
	wg.Wait()
	comments := []articleThreadComment{}
	for _, block := range blocks {
		comments = append(comments, block...)
	}
	return comments, root.Descendants, root.Text, nil
}
