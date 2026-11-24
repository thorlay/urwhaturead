package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"quick/internal/clustering"
	"quick/internal/forumpublic"
	"quick/internal/models"
	"quick/internal/textclean"
)

func (w *RSSWorker) savePublicDiscussions(ctx context.Context, source models.Source, feed *gofeed.Feed, now time.Time) (int, error) {
	switch source.RSSURL {
	case forumpublic.LobstersFeed:
		return w.saveLobstersDiscussions(ctx, source.ID, feed.Items, now)
	case forumpublic.BogleheadsFeed:
		return w.saveBogleheadsDiscussions(ctx, source.ID, feed.Items, now)
	default:
		return 0, errors.New("unknown public discussion source")
	}
}

type lobstersDiscussion struct {
	article models.Article
	sample  forumpublic.Snapshot
}

func (w *RSSWorker) saveLobstersDiscussions(ctx context.Context, sourceID uint64, items []*gofeed.Item, now time.Time) (int, error) {
	bounded, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	if len(items) > 25 {
		items = items[:25]
	}
	results := make([]lobstersDiscussion, len(items))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 3)
	for i, item := range items {
		topic, ok := forumpublic.LobstersTopic(item.GUID)
		if !ok {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-bounded.Done():
				return
			}
			main, replies, err := w.fetchLobstersReplies(bounded, topic, now)
			if err != nil {
				log.Printf("read Lobsters discussion %s: %v", topic, err)
				return
			}
			article := publicDiscussionArticle(sourceID, topic, topic, textclean.NormalizeInline(item.Title))
			article.PublishedAt = item.PublishedParsed
			if main != "" {
				article.Content = &main
				article.Summary = &main
			}
			sample := forumpublic.Snapshot{Kind: forumpublic.Lobsters, Replies: replies}
			if other, ok := forumpublic.LobstersTopic(item.Link); !ok || other != topic {
				sample.ExternalLink = item.Link
			}
			results[i] = lobstersDiscussion{article: article, sample: sample}
		}()
	}
	wg.Wait()
	inserted, successful := 0, 0
	for _, result := range results {
		if result.article.Link == "" {
			continue
		}
		successful++
		if created, err := w.upsertPublicDiscussion(ctx, result.article, result.sample); err != nil {
			return inserted, err
		} else if created {
			inserted++
		}
	}
	if len(items) > 0 && successful == 0 {
		return inserted, errors.New("could not read any Lobsters discussion pages")
	}
	return inserted, nil
}

func (w *RSSWorker) fetchLobstersReplies(ctx context.Context, topic string, now time.Time) (string, []forumpublic.Reply, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, topic, nil)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("User-Agent", w.userAgent)
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	finalTopic, ok := forumpublic.LobstersTopic(resp.Request.URL.String())
	if !ok || finalTopic != topic {
		return "", nil, errors.New("unexpected discussion page")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if err != nil || len(body) > 4<<20 {
		return "", nil, errors.New("unable to read bounded discussion page")
	}
	return parseLobstersReplies(body, topic, now)
}

func parseLobstersReplies(body []byte, topic string, now time.Time) (string, []forumpublic.Reply, error) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil || doc.Find("li.story[data-shortid]").Length() == 0 {
		return "", nil, errors.New("missing Lobsters story")
	}
	replies := make([]forumpublic.Reply, 0)
	doc.Find("div.comment[id^=c_]").Each(func(_ int, el *goquery.Selection) {
		id, _ := el.Attr("id")
		link, ok := forumpublic.LobstersReplyLink(topic, id)
		if !ok {
			return
		}
		details := el.Children().Filter(".details")
		byline := details.Children().Filter(".byline")
		stamp, _ := byline.Find("time").Attr("data-at-unix")
		unix, err := strconv.ParseInt(stamp, 10, 64)
		if err != nil || unix <= 0 {
			return
		}
		content, _ := details.Children().Filter(".comment_text").Html()
		content = discussionText(content)
		if content == "" || content == "[deleted]" || content == "[removed]" {
			return
		}
		reply := forumpublic.Reply{
			Link: link, Author: strings.TrimSpace(byline.Find("a[href^='/~']:not([aria-hidden])").First().Text()),
			At: time.Unix(unix, 0).UTC(), Content: content,
		}
		if n, err := strconv.Atoi(strings.TrimSpace(el.Children().Filter(".voters").Find(".upvoter").Text())); err == nil {
			reply.Upvotes = &n
		}
		replies = append(replies, reply)
	})
	main, _ := doc.Find(".story_text").First().Html()
	return discussionText(main), forumpublic.RecentReplies(replies, now), nil
}

type bogleheadsTopicBatch struct {
	Title     string
	Opening   *forumpublic.Reply
	Ambiguous bool
	Replies   []forumpublic.Reply
}

func bogleheadsTopicBatches(items []*gofeed.Item, now time.Time) map[string]*bogleheadsTopicBatch {
	topics := make(map[string]*bogleheadsTopicBatch)
	for _, entry := range items {
		if entry.PublishedParsed == nil || entry.PublishedParsed.Before(now.Add(-forumpublic.Window)) || entry.PublishedParsed.After(now) {
			continue
		}
		link, ok := forumpublic.BogleheadsPost(entry.Link)
		if !ok {
			continue
		}
		title := textclean.NormalizeInline(entry.Title)
		title, ok = strings.CutPrefix(title, "Investing - Theory, News & General • ")
		if !ok {
			continue
		}
		subject, isReply := strings.CutPrefix(title, "Re: ")
		if subject == "" {
			continue
		}
		batch := topics[subject]
		if batch == nil {
			batch = &bogleheadsTopicBatch{Title: subject}
			topics[subject] = batch
		}
		content := bogleheadsPostText(firstNonEmpty(entry.Content, entry.Description))
		if content == "" {
			continue
		}
		post := forumpublic.Reply{Link: link, At: entry.PublishedParsed.UTC(), Content: content}
		if entry.Author != nil {
			post.Author = textclean.NormalizeInline(entry.Author.Name)
		}
		if isReply {
			batch.Replies = append(batch.Replies, post)
		} else if batch.Opening == nil {
			batch.Opening = &post
		} else if batch.Opening.Link != post.Link {
			batch.Ambiguous = true
		}
	}
	return topics
}

func bogleheadsPostText(raw string) string {
	// phpBB includes quoted posts and a Statistics footer in its Atom entry.
	// Keep the author's own words and remove those duplicated passages.
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(raw))
	if err != nil {
		return ""
	}
	doc.Find("blockquote").Remove()
	doc.Find("p").Each(func(_ int, p *goquery.Selection) {
		if strings.HasPrefix(strings.TrimSpace(p.Text()), "Statistics: Posted by") {
			p.Remove()
		}
	})
	body, _ := doc.Find("body").Html()
	return discussionText(body)
}

func (w *RSSWorker) saveBogleheadsDiscussions(ctx context.Context, sourceID uint64, items []*gofeed.Item, now time.Time) (int, error) {
	inserted := 0
	for subject, batch := range bogleheadsTopicBatches(items, now) {
		guid := fmt.Sprintf("bogleheads:10:%x", sha256.Sum256([]byte(subject)))
		article := publicDiscussionArticle(sourceID, guid, "", batch.Title)
		sample := forumpublic.Snapshot{Kind: forumpublic.Bogleheads}
		var existing models.Article
		err := w.db.WithContext(ctx).Where("source_id = ? AND content_hash = ?", sourceID, article.ContentHash).Take(&existing).Error
		if err == nil {
			article = existing
			if previous := forumpublic.FromRaw(existing.Raw); previous != nil {
				sample = *previous
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return inserted, err
		}
		sample.Ambiguous = sample.Ambiguous || batch.Ambiguous || (batch.Opening != nil && sample.OpeningLink != "" && sample.OpeningLink != batch.Opening.Link)
		// Put the latest version first for deduplication on an edited reply.
		sample.Replies = forumpublic.RecentReplies(append(batch.Replies, sample.Replies...), now)
		if sample.Ambiguous {
			sample.Replies = nil
		}
		if batch.Opening != nil {
			article.Link = batch.Opening.Link
			article.Content = &batch.Opening.Content
			article.Summary = &batch.Opening.Content
			article.Author = &batch.Opening.Author
			article.PublishedAt = &batch.Opening.At
			sample.OpeningLink = batch.Opening.Link
		}
		if article.Link == "" && len(sample.Replies) > 0 {
			article.Link = sample.Replies[0].Link
		}
		if article.Link == "" {
			continue
		}
		if created, err := w.upsertPublicDiscussion(ctx, article, sample); err != nil {
			return inserted, err
		} else if created {
			inserted++
		}
	}
	return inserted, nil
}

func discussionText(raw string) string {
	runes := []rune(textclean.NormalizeFromHTMLBlock(raw))
	if len(runes) > 1100 {
		return string(runes[:1100]) + "…"
	}
	return string(runes)
}

func publicDiscussionArticle(sourceID uint64, guid, link, title string) models.Article {
	return models.Article{
		SourceID: sourceID, RawGUID: &guid, Link: link, Title: title,
		ContentHash:     fmt.Sprintf("%x", sha256.Sum256([]byte(guid))),
		NormalizedTitle: clustering.NormalizeTitle(title),
	}
}

func (w *RSSWorker) upsertPublicDiscussion(ctx context.Context, article models.Article, sample forumpublic.Snapshot) (bool, error) {
	article.CanonicalLink = clustering.CanonicalizeLink(article.Link)
	data, err := json.Marshal(forumpublic.Raw{Discussion: &sample})
	if err != nil {
		return false, err
	}
	article.Raw = datatypes.JSON(data)
	article.ForumActivityAt = nil
	if n := len(sample.Replies); n > 0 {
		article.ForumActivityAt = &sample.Replies[n-1].At
	}
	tx := w.db.WithContext(ctx)
	if article.ID != 0 {
		return false, tx.Model(&article).Select("link", "canonical_link", "summary", "content", "author", "published_at", "raw", "forum_activity_at").Updates(&article).Error
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source_id"}, {Name: "content_hash"}},
		DoNothing: true,
	}).Create(&article)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, tx.Model(&models.Article{}).Where("source_id = ? AND content_hash = ?", article.SourceID, article.ContentHash).
			Select("link", "canonical_link", "summary", "content", "author", "published_at", "raw", "forum_activity_at").Updates(&article).Error
	}
	w.enqueueArticleClustering(article.ID)
	return true, nil
}
