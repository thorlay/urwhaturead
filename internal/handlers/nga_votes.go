package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The NGA app endpoint returns per-post vote_good; RSSHub's body feed omits it.
// Fetch read-only metadata for the same first-page replies and join by post ID.
func (s *ArticleContentService) enrichNGAVotes(ctx context.Context, tid string, thread *articleThread) {
	thread.VoteMetadataVersion = 1
	if s.ngaPassportUID == "" || s.ngaPassportCID == "" || len(thread.Comments) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.ngaVoteEndpoint, strings.NewReader(url.Values{"tid": {tid}}.Encode()))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-User-Agent", "NGA_skull/6.0.5(iPhone10,3;iOS 12.0.1)")
	req.Header.Set("Cookie", "ngaPassportUid="+s.ngaPassportUID+"; ngaPassportCid="+s.ngaPassportCID+";")
	client := *s.httpClient
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
		Result []struct {
			PID  json.Number     `json:"pid"`
			Good json.RawMessage `json:"vote_good"`
		} `json:"result"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&data) != nil || data.Code != 0 {
		return
	}
	votes := map[string]*int{}
	for _, post := range data.Result {
		if upvotes := parseNGAUpvotes(post.Good); upvotes != nil {
			votes[post.PID.String()] = upvotes
		}
	}
	for i := range thread.Comments {
		u, err := url.Parse(thread.Comments[i].Link)
		if err != nil || !strings.HasPrefix(u.Fragment, "postcontent") {
			continue
		}
		thread.Comments[i].Upvotes = votes[strings.TrimPrefix(u.Fragment, "postcontent")]
	}
}

func parseNGAUpvotes(raw json.RawMessage) *int {
	text := strings.TrimSpace(string(raw))
	if strings.HasPrefix(text, "\"") {
		if json.Unmarshal(raw, &text) != nil {
			return nil
		}
	}
	value, err := strconv.Atoi(text)
	if err != nil || value < 0 {
		return nil
	}
	return &value
}
