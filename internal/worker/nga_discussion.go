package worker

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
	"quick/internal/feedextract"
	"quick/internal/models"
	"quick/internal/textclean"
)

func isNGABoardFeed(rawURL string) bool {
	u, err := url.Parse(rawURL)
	return err == nil && strings.Contains(u.Path, "/nga/forum/")
}

// Board feeds contain main posts only. Enrich a bounded set via the same RSSHub
// instance; cookies stay in RSSHub and are never copied into Quick's database.
func (w *RSSWorker) enrichNGAFeedDiscussions(ctx context.Context, source models.Source, feed *gofeed.Feed) {
	u, err := url.Parse(source.RSSURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return
	}
	index := strings.LastIndex(u.Path, "/nga/forum/")
	if index < 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	w.enrichNGAReplyCounts(ctx, u.Path, feed)
	sem := make(chan struct{}, 3)
	var wg sync.WaitGroup
	count := 0
	// Old pinned guides often lead board feeds. Prefer recently published threads
	// so the bounded reply fetch benefits the same candidates as the briefing.
	items := append([]*gofeed.Item(nil), feed.Items...)
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i].PublishedParsed, items[j].PublishedParsed
		recentA := a != nil && a.After(time.Now().Add(-24*time.Hour))
		recentB := b != nil && b.After(time.Now().Add(-24*time.Hour))
		if recentA != recentB {
			return recentA
		}
		if recentA && recentB {
			ca, cb := feedextract.ReplyCountFromFeedItem(items[i]), feedextract.ReplyCountFromFeedItem(items[j])
			if ca != nil && cb != nil && *ca != *cb {
				return *ca > *cb
			}
		}
		if a == nil {
			return false
		}
		return b == nil || a.After(*b)
	})
	for _, item := range items {
		tid, ok := feedextract.NGAThreadID(item.Link)
		if !ok || count >= 12 {
			continue
		}
		count++
		wg.Add(1)
		go func(item *gofeed.Item, tid string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			postURL := *u
			postURL.Path = u.Path[:index] + "/nga/post/" + tid
			postURL.RawPath, postURL.RawQuery, postURL.Fragment = "", "", ""
			content, err := w.fetchNGADiscussion(ctx, postURL.String(), item.Description)
			if err != nil {
				log.Printf("NGA reply fetch unavailable source=%d thread=%s: %v", source.ID, tid, err)
				return
			}
			item.Content = content
		}(item, tid)
	}
	wg.Wait()
}

func (w *RSSWorker) fetchNGADiscussion(ctx context.Context, feedURL string, mainPost string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", w.userAgent)
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	feed, err := gofeed.NewParser().Parse(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return "", err
	}
	if feed == nil || len(feed.Items) == 0 {
		return "", fmt.Errorf("no accessible posts; check NGA login configuration")
	}
	var b strings.Builder
	b.WriteString("[NGA 主帖]\n" + textclean.NormalizeFromHTMLBlock(mainPost))
	b.WriteString("\n[NGA 回复材料：仅含接口返回的部分楼层，不代表完整讨论]\n")
	replies := 0
	for _, post := range feed.Items {
		if post.GUID == "postcontent0" || strings.HasSuffix(post.Link, "#postcontent0") {
			continue
		}
		author := "未知作者"
		if post.Author != nil {
			author = textclean.NormalizeInline(post.Author.Name)
		}
		body := textclean.NormalizeFromHTMLBlock(firstNonEmpty(post.Content, post.Description))
		if body == "" || body == textclean.NormalizeFromHTMLBlock(mainPost) {
			continue
		}
		if b.Len() > 100000 {
			b.WriteString("\n[其余楼层省略]\n")
			break
		}
		fmt.Fprintf(&b, "\n楼层作者：%s\n楼层链接：%s\n%s\n", author, post.Link, body)
		replies++
	}
	if replies == 0 {
		b.WriteString("[接口未返回可用回复；回复材料不足，不能判断讨论观点]\n")
	}
	return b.String(), nil
}
