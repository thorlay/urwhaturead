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

	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
	"quick/internal/feedextract"
	"quick/internal/models"
)

// The upstream RSS route omits its upvote field from RSS. Read the matching
// public board once per poll, keeping paper identity and submission dates intact.
func (w *RSSWorker) enrichPaperFeed(ctx context.Context, source models.Source, feed *gofeed.Feed) {
	u, err := url.Parse(source.RSSURL)
	if err != nil || !strings.Contains(u.Path, "/huggingface/daily-papers") {
		return
	}
	for _, item := range feed.Items {
		if _, ok := feedextract.ArxivID(item.Link); ok {
			setPaperExtension(item, "paperSeenAt", time.Now().UTC().Format(time.RFC3339))
		}
	}
	endpoint := "https://huggingface.co/papers"
	if strings.Contains(u.Path, "/week") {
		year, week := time.Now().UTC().ISOWeek()
		endpoint += "/week/" + strconv.Itoa(year) + "-W" + fmtWeek(week)
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", w.userAgent)
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return
	}
	doc, err := goquery.NewDocumentFromReader(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return
	}
	props, _ := doc.Find(`[data-target="DailyPapers"]`).Attr("data-props")
	var data struct {
		DailyPapers []struct {
			Paper struct {
				ID         string `json:"id"`
				Upvotes    *int   `json:"upvotes"`
				GithubRepo string `json:"githubRepo"`
			} `json:"paper"`
		} `json:"dailyPapers"`
	}
	if json.Unmarshal([]byte(props), &data) != nil {
		return
	}
	votes := map[string]*int{}
	codes := map[string]string{}
	for _, p := range data.DailyPapers {
		votes[p.Paper.ID] = p.Paper.Upvotes
		codes[p.Paper.ID] = p.Paper.GithubRepo
	}
	for _, item := range feed.Items {
		id, ok := feedextract.ArxivID(item.Link)
		if !ok {
			continue
		}
		setPaperExtension(item, "paperSeenAt", time.Now().UTC().Format(time.RFC3339))
		if count := votes[id]; count != nil && *count >= 0 {
			setPaperExtension(item, "paperVotes", strconv.Itoa(*count))
		}
		if code := codes[id]; strings.HasPrefix(code, "https://github.com/") {
			setPaperExtension(item, "paperCode", code)
		}
	}
}
func fmtWeek(week int) string {
	if week < 10 {
		return "0" + strconv.Itoa(week)
	}
	return strconv.Itoa(week)
}
func setPaperExtension(item *gofeed.Item, name, value string) {
	if item.Extensions == nil {
		item.Extensions = ext.Extensions{}
	}
	if item.Extensions["quick"] == nil {
		item.Extensions["quick"] = map[string][]ext.Extension{}
	}
	item.Extensions["quick"][name] = []ext.Extension{{Name: name, Value: value}}
}
