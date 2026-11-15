package worker

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"

	"quick/internal/feedextract"
)

// Read board metadata once; the RSS body does not expose reliable reply totals.
func (w *RSSWorker) enrichNGAReplyCounts(ctx context.Context, path string, feed *gofeed.Feed) {
	if w.ngaPassportUID == "" || w.ngaPassportCID == "" {
		return
	}
	index := strings.LastIndex(path, "/nga/forum/")
	if index < 0 {
		return
	}
	parts := strings.Split(strings.TrimPrefix(path[index:], "/nga/forum/"), "/")
	if _, err := strconv.Atoi(parts[0]); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.ngaTopicEndpoint, strings.NewReader(url.Values{"fid": {parts[0]}}.Encode()))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-User-Agent", "NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)")
	req.Header.Set("Cookie", "ngaPassportUid="+w.ngaPassportUID+"; ngaPassportCid="+w.ngaPassportCID+";")
	client := *w.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var data struct {
		Code   int `json:"code"`
		Result struct {
			Data []struct {
				TID     json.Number `json:"tid"`
				Replies *int        `json:"replies"`
			} `json:"data"`
		} `json:"result"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&data) != nil || data.Code != 0 {
		return
	}
	counts := map[string]int{}
	for _, topic := range data.Result.Data {
		if topic.Replies != nil && *topic.Replies >= 0 {
			counts[topic.TID.String()] = *topic.Replies
		}
	}
	for _, item := range feed.Items {
		tid, ok := feedextract.NGAThreadID(item.Link)
		if !ok {
			continue
		}
		count, ok := counts[tid]
		if !ok {
			continue
		}
		feedextract.SetForumReplyCount(item, count)
	}
}
