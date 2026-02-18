package handlers

import (
	"bytes"
	"context"
	"errors"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"quick/internal/aisummary"
	"quick/internal/models"

	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
	"github.com/mmcdole/gofeed"
	"golang.org/x/net/publicsuffix"
	"gorm.io/gorm"
)

const (
	maxSummaryCommentCount  = 30
	threadCacheTTL          = 5 * time.Minute
	threadMaxBodyBytes      = 2 * 1024 * 1024
	threadMaxComments       = 120
	threadMaxContentChars   = 12000
	threadMaxCommentChars   = 1200
	threadReadMoreHintText  = "阅读完整话题"
	externalCacheTTL        = 15 * time.Minute
	externalMaxBodyBytes    = 3 * 1024 * 1024
	externalMaxContentChars = 16000
)

var (
	uscardTopicLinkPattern = regexp.MustCompile(`^https?://www\.uscardforum\.com/t/topic/(\d+)(?:/\d+)?/?$`)
	uscardPostLinkPattern  = regexp.MustCompile(`/t/topic/\d+/(\d+)$`)
	v2exReplyLinkPattern   = regexp.MustCompile(`#reply(\d+)$`)
	htmlTagPattern         = regexp.MustCompile(`<[^>]*>`)
	spacePattern           = regexp.MustCompile(`\s+`)
)

type ArticleHandler struct {
	db         *gorm.DB
	httpClient *http.Client
	parser     *gofeed.Parser
	summarizer *aisummary.Client

	cacheMu sync.RWMutex
	cache   map[string]cachedThread

	externalCacheMu sync.RWMutex
	externalCache   map[string]cachedExternalArticle
}

type cachedThread struct {
	value     articleThread
	expiresAt time.Time
}

type cachedExternalArticle struct {
	value     articleExternalContent
	expiresAt time.Time
}

func NewArticleHandler(db *gorm.DB, summarizer *aisummary.Client) *ArticleHandler {
	return &ArticleHandler{
		db:         db,
		summarizer: summarizer,
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
		parser:        gofeed.NewParser(),
		cache:         make(map[string]cachedThread),
		externalCache: make(map[string]cachedExternalArticle),
	}
}

func (h *ArticleHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/:id", h.Get)
	group.GET("/:id/summary", h.GetSummary)
	group.POST("/:id/summary", h.Summarize)
	group.POST("/:id/track-thread", h.TrackThread)
}

type articleThreadComment struct {
	PostNumber  int        `json:"post_number"`
	Author      string     `json:"author"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	Link        string     `json:"link"`
	Content     string     `json:"content"`
}

type articleThread struct {
	TopicURL    string                 `json:"topic_url"`
	FeedURL     string                 `json:"feed_url"`
	TopicTitle  string                 `json:"topic_title"`
	FullContent string                 `json:"full_content"`
	Comments    []articleThreadComment `json:"comments"`
	TotalPosts  int                    `json:"total_posts"`
	Truncated   bool                   `json:"truncated"`
}

type articleExternalContent struct {
	URL       string `json:"url"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

type articleDetail struct {
	ID             uint64                  `json:"id"`
	SourceID       uint64                  `json:"source_id"`
	SourceName     string                  `json:"source_name"`
	SourceCategory string                  `json:"source_category"`
	SourceRSSURL   string                  `json:"-" gorm:"column:source_rss_url"`
	RawGUID        *string                 `json:"raw_guid,omitempty"`
	Title          string                  `json:"title"`
	Link           string                  `json:"link"`
	Summary        *string                 `json:"summary,omitempty"`
	Content        *string                 `json:"content,omitempty"`
	Author         *string                 `json:"author,omitempty"`
	PublishedAt    *time.Time              `json:"published_at,omitempty"`
	ImageURL       *string                 `json:"image_url,omitempty"`
	Thread         *articleThread          `json:"thread,omitempty" gorm:"-"`
	External       *articleExternalContent `json:"external,omitempty" gorm:"-"`
	CreatedAt      time.Time               `json:"created_at"`
}

type articleSummaryPayload struct {
	ArticleID   uint64    `json:"article_id"`
	Summary     string    `json:"summary"`
	Model       string    `json:"model"`
	InputChars  int       `json:"input_chars"`
	Truncated   bool      `json:"truncated"`
	Provider    string    `json:"provider"`
	GeneratedAt time.Time `json:"generated_at"`
	CacheHit    bool      `json:"cache_hit"`
}

type threadPost struct {
	PostNumber  int
	Author      string
	PublishedAt *time.Time
	Link        string
	Content     string
}

type forumThreadTarget struct {
	FeedURLs             []string
	TopicURL             string
	DefaultTitle         string
	PostNumberFromItemFn func(itemLink string) int
}

func (h *ArticleHandler) Get(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	article, err := h.loadArticleDetail(c.Request.Context(), id)
	if err != nil {
		h.handleLoadArticleError(c, err)
		return
	}

	c.JSON(http.StatusOK, article)
}

func (h *ArticleHandler) TrackThread(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	var article struct {
		ID    uint64
		Title string
		Link  string
	}
	err = h.db.WithContext(c.Request.Context()).
		Table("articles").
		Select("id, title, link").
		Where("id = ?", id).
		Take(&article).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			notFound(c, "article not found")
			return
		}
		internalServerError(c, "query article failed", err)
		return
	}

	target, ok := forumThreadTargetFromLink(article.Link)
	if !ok || len(target.FeedURLs) == 0 {
		badRequest(c, "article link does not support thread tracking")
		return
	}

	feedURL := target.FeedURLs[0]
	var existing models.Source
	existingErr := h.db.WithContext(c.Request.Context()).
		Where("rss_url = ?", feedURL).
		Order("id DESC").
		Take(&existing).Error
	if existingErr == nil {
		c.JSON(http.StatusOK, gin.H{
			"ok":         true,
			"created":    false,
			"article_id": id,
			"topic_url":  target.TopicURL,
			"feed_url":   feedURL,
			"source":     existing,
		})
		return
	}
	if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		internalServerError(c, "query existing tracking source failed", existingErr)
		return
	}

	source := models.Source{
		Name:            buildThreadTrackingSourceName(article.Title, target.DefaultTitle),
		RSSURL:          feedURL,
		SiteKey:         normalizeSiteKeyFromURL(feedURL),
		Category:        "forum-thread",
		Enabled:         true,
		PollIntervalSec: 120,
	}
	if err := h.db.WithContext(c.Request.Context()).Create(&source).Error; err != nil {
		internalServerError(c, "create tracking source failed", err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"ok":         true,
		"created":    true,
		"article_id": id,
		"topic_url":  target.TopicURL,
		"feed_url":   feedURL,
		"source":     source,
	})
}

func (h *ArticleHandler) Summarize(c *gin.Context) {
	requestStartedAt := time.Now()
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	if h.summarizer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "ai summary is not configured",
		})
		return
	}
	refresh := parseBoolQuery(c.Query("refresh"))
	log.Printf("summary request started article_id=%d refresh=%t", id, refresh)

	if !refresh {
		cacheLookupStartedAt := time.Now()
		payload, found, err := h.getCachedSummaryPayload(c.Request.Context(), id)
		if err != nil {
			internalServerError(c, "query summary cache failed", err)
			return
		}
		cacheLookupMs := time.Since(cacheLookupStartedAt).Milliseconds()
		if found {
			totalMs := time.Since(requestStartedAt).Milliseconds()
			log.Printf("summary cache hit article_id=%d cache_lookup_ms=%d total_ms=%d", id, cacheLookupMs, totalMs)
			c.JSON(http.StatusOK, gin.H{
				"data": payload,
			})
			return
		}
		log.Printf("summary cache miss article_id=%d cache_lookup_ms=%d", id, cacheLookupMs)
	}

	loadStartedAt := time.Now()
	article, err := h.loadArticleDetail(c.Request.Context(), id)
	if err != nil {
		h.handleLoadArticleError(c, err)
		return
	}
	loadMs := time.Since(loadStartedAt).Milliseconds()

	text := buildSummarySourceText(article)
	if strings.TrimSpace(text) == "" {
		badRequest(c, "article content is empty")
		return
	}

	aiStartedAt := time.Now()
	result, err := h.summarizer.Summarize(c.Request.Context(), article.Title, text)
	if err != nil {
		log.Printf("summary ai failed article_id=%d input_chars=%d load_ms=%d ai_ms=%d total_ms=%d err=%v",
			id,
			len(text),
			loadMs,
			time.Since(aiStartedAt).Milliseconds(),
			time.Since(requestStartedAt).Milliseconds(),
			err,
		)
		badGateway(c, err.Error())
		return
	}
	aiMs := time.Since(aiStartedAt).Milliseconds()

	summaryRecord := models.ArticleSummary{
		ArticleID:   id,
		Summary:     result.Summary,
		Model:       result.Model,
		Provider:    result.ProviderName,
		InputChars:  result.InputChars,
		Truncated:   result.Truncated,
		GeneratedAt: result.GeneratedAt,
	}
	saveStartedAt := time.Now()
	if err := h.db.WithContext(c.Request.Context()).
		Where("article_id = ?", id).
		Assign(summaryRecord).
		FirstOrCreate(&summaryRecord).Error; err != nil {
		internalServerError(c, "save summary cache failed", err)
		return
	}
	saveMs := time.Since(saveStartedAt).Milliseconds()
	totalMs := time.Since(requestStartedAt).Milliseconds()
	log.Printf("summary generated article_id=%d input_chars=%d truncated=%t load_ms=%d ai_ms=%d save_ms=%d total_ms=%d",
		id,
		result.InputChars,
		result.Truncated,
		loadMs,
		aiMs,
		saveMs,
		totalMs,
	)

	c.JSON(http.StatusOK, gin.H{
		"data": articleSummaryPayload{
			ArticleID:   article.ID,
			Summary:     result.Summary,
			Model:       result.Model,
			InputChars:  result.InputChars,
			Truncated:   result.Truncated,
			Provider:    result.ProviderName,
			GeneratedAt: result.GeneratedAt,
			CacheHit:    false,
		},
	})
}

func (h *ArticleHandler) GetSummary(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	payload, found, err := h.getCachedSummaryPayload(c.Request.Context(), id)
	if err != nil {
		internalServerError(c, "query summary cache failed", err)
		return
	}
	if !found {
		notFound(c, "summary not found")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": payload,
	})
}

func (h *ArticleHandler) loadArticleDetail(ctx context.Context, id uint64) (articleDetail, error) {
	var article articleDetail
	err := h.db.
		WithContext(ctx).
		Table("articles AS a").
		Select(`
			a.id,
			a.source_id,
			s.name AS source_name,
			s.category AS source_category,
			s.rss_url AS source_rss_url,
			a.raw_guid,
			a.title,
			a.link,
			a.summary,
			a.content,
			a.author,
			a.published_at,
			a.image_url,
			a.created_at
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id").
		Where("a.id = ?", id).
		Take(&article).Error
	if err != nil {
		return articleDetail{}, err
	}

	if thread, ok := h.fetchThreadForTopic(ctx, article.Link); ok {
		article.Thread = thread
	}
	if shouldFetchExternalArticle(article.SourceName, article.SourceRSSURL, article.Link) {
		if external, ok := h.fetchExternalArticle(ctx, article.Link); ok {
			article.External = external
		}
	}

	return article, nil
}

func (h *ArticleHandler) handleLoadArticleError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		notFound(c, "article not found")
		return
	}
	internalServerError(c, "query article failed", err)
}

func buildSummarySourceText(article articleDetail) string {
	parts := make([]string, 0, 6)
	if article.Summary != nil && strings.TrimSpace(*article.Summary) != "" {
		parts = append(parts, strings.TrimSpace(*article.Summary))
	}
	if article.Content != nil && strings.TrimSpace(*article.Content) != "" {
		parts = append(parts, strings.TrimSpace(*article.Content))
	}
	if article.External != nil && strings.TrimSpace(article.External.Content) != "" {
		parts = append(parts, strings.TrimSpace(article.External.Content))
	}

	if article.Thread != nil {
		if strings.TrimSpace(article.Thread.FullContent) != "" {
			parts = append(parts, article.Thread.FullContent)
		}
		limit := len(article.Thread.Comments)
		if limit > maxSummaryCommentCount {
			limit = maxSummaryCommentCount
		}
		for i := 0; i < limit; i++ {
			comment := article.Thread.Comments[i]
			text := strings.TrimSpace(comment.Content)
			if text == "" {
				continue
			}
			parts = append(parts, text)
		}
	}

	return strings.Join(parts, "\n\n")
}

func (h *ArticleHandler) fetchThreadForTopic(ctx context.Context, topicLink string) (*articleThread, bool) {
	target, ok := forumThreadTargetFromLink(topicLink)
	if !ok {
		return nil, false
	}

	for _, feedURL := range target.FeedURLs {
		if cached, ok := h.getCachedThread(feedURL, time.Now().UTC()); ok {
			return &cached, true
		}

		thread, err := h.fetchThreadFromFeedURL(ctx, target, feedURL)
		if err != nil {
			log.Printf("thread fetch failed topic=%s feed=%s err=%v", topicLink, feedURL, err)
			continue
		}

		h.setCachedThread(feedURL, *thread, time.Now().UTC().Add(threadCacheTTL))
		return thread, true
	}

	return nil, false
}

func forumThreadTargetFromLink(rawLink string) (forumThreadTarget, bool) {
	feedURL, topicURL, ok := uscardTopicRSSURL(rawLink)
	if ok {
		return forumThreadTarget{
			FeedURLs:             []string{feedURL},
			TopicURL:             topicURL,
			DefaultTitle:         "USCardForum 话题",
			PostNumberFromItemFn: uscardPostNumberFromLink,
		}, true
	}

	feedURLs, topicURL, ok := v2exTopicRSSURLs(rawLink)
	if ok {
		return forumThreadTarget{
			FeedURLs:             feedURLs,
			TopicURL:             topicURL,
			DefaultTitle:         "V2EX 话题",
			PostNumberFromItemFn: v2exPostNumberFromLink,
		}, true
	}

	return forumThreadTarget{}, false
}

func uscardTopicRSSURL(rawLink string) (feedURL string, topicURL string, ok bool) {
	link := strings.TrimSpace(rawLink)
	match := uscardTopicLinkPattern.FindStringSubmatch(link)
	if len(match) < 2 {
		return "", "", false
	}
	topicID := match[1]
	topicURL = "https://www.uscardforum.com/t/topic/" + topicID
	return topicURL + ".rss", topicURL, true
}

func v2exTopicRSSURLs(rawLink string) (feedURLs []string, topicURL string, ok bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawLink))
	if err != nil {
		return nil, "", false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host != "www.v2ex.com" && host != "v2ex.com" {
		return nil, "", false
	}

	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "t" {
		return nil, "", false
	}
	topicID := strings.TrimSpace(parts[1])
	if topicID == "" {
		return nil, "", false
	}
	if _, err := strconv.Atoi(topicID); err != nil {
		return nil, "", false
	}

	topicURL = "https://www.v2ex.com/t/" + topicID
	feedURLs = []string{
		"https://rsshub.rssforever.com/v2ex/post/" + topicID,
	}
	return feedURLs, topicURL, true
}

func (h *ArticleHandler) fetchThreadFromFeedURL(ctx context.Context, target forumThreadTarget, feedURL string) (*articleThread, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "quick-thread-fetcher/0.1")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("unexpected status code: " + strconv.Itoa(resp.StatusCode))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, threadMaxBodyBytes))
	if err != nil {
		return nil, err
	}

	feed, err := h.parser.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	if feed == nil || len(feed.Items) == 0 {
		return nil, errors.New("feed has no items")
	}

	posts := make([]threadPost, 0, len(feed.Items))
	for _, item := range feed.Items {
		mapped, ok := mapThreadPost(item, target.PostNumberFromItemFn)
		if !ok {
			continue
		}
		posts = append(posts, mapped)
	}
	if len(posts) == 0 {
		return nil, errors.New("no valid thread posts parsed")
	}

	sort.Slice(posts, func(i, j int) bool {
		a := posts[i]
		b := posts[j]
		if a.PostNumber > 0 && b.PostNumber > 0 && a.PostNumber != b.PostNumber {
			return a.PostNumber < b.PostNumber
		}
		if a.PublishedAt != nil && b.PublishedAt != nil && !a.PublishedAt.Equal(*b.PublishedAt) {
			return a.PublishedAt.Before(*b.PublishedAt)
		}
		return a.Link < b.Link
	})

	firstIndex := 0
	for idx, post := range posts {
		if post.PostNumber == 1 {
			firstIndex = idx
			break
		}
	}

	full := posts[firstIndex].Content
	if len(full) > threadMaxContentChars {
		full = full[:threadMaxContentChars]
	}

	comments := make([]articleThreadComment, 0, len(posts)-1)
	for idx, post := range posts {
		if idx == firstIndex {
			continue
		}
		content := post.Content
		if len(content) > threadMaxCommentChars {
			content = content[:threadMaxCommentChars]
		}
		comments = append(comments, articleThreadComment{
			PostNumber:  post.PostNumber,
			Author:      post.Author,
			PublishedAt: post.PublishedAt,
			Link:        post.Link,
			Content:     content,
		})
	}

	truncated := false
	if len(comments) > threadMaxComments {
		comments = comments[:threadMaxComments]
		truncated = true
	}

	thread := articleThread{
		TopicURL:    target.TopicURL,
		FeedURL:     feedURL,
		TopicTitle:  strings.TrimSpace(feed.Title),
		FullContent: full,
		Comments:    comments,
		TotalPosts:  len(posts),
		Truncated:   truncated,
	}
	if thread.TopicTitle == "" {
		thread.TopicTitle = target.DefaultTitle
	}

	return &thread, nil
}

func mapThreadPost(item *gofeed.Item, postNumberFromLinkFn func(string) int) (threadPost, bool) {
	if item == nil {
		return threadPost{}, false
	}

	link := strings.TrimSpace(item.Link)
	if link == "" {
		return threadPost{}, false
	}

	content := normalizeThreadText(firstNonEmpty(item.Content, item.Description))
	if content == "" {
		content = strings.TrimSpace(item.Title)
	}
	if content == "" {
		return threadPost{}, false
	}

	author := ""
	if item.Author != nil {
		author = strings.TrimSpace(item.Author.Name)
	}

	var publishedAt *time.Time
	if item.PublishedParsed != nil {
		value := item.PublishedParsed.UTC()
		publishedAt = &value
	} else if item.UpdatedParsed != nil {
		value := item.UpdatedParsed.UTC()
		publishedAt = &value
	}

	postNumber := 0
	if postNumberFromLinkFn != nil {
		postNumber = postNumberFromLinkFn(link)
	}

	return threadPost{
		PostNumber:  postNumber,
		Author:      author,
		PublishedAt: publishedAt,
		Link:        link,
		Content:     content,
	}, true
}

func uscardPostNumberFromLink(link string) int {
	match := uscardPostLinkPattern.FindStringSubmatch(strings.TrimSpace(link))
	if len(match) < 2 {
		return 0
	}
	value, err := strconv.Atoi(match[1])
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func v2exPostNumberFromLink(link string) int {
	match := v2exReplyLinkPattern.FindStringSubmatch(strings.TrimSpace(link))
	if len(match) < 2 {
		return 0
	}
	value, err := strconv.Atoi(match[1])
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func normalizeThreadText(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	value = html.UnescapeString(value)
	value = htmlTagPattern.ReplaceAllString(value, " ")
	value = strings.ReplaceAll(value, threadReadMoreHintText, " ")
	value = spacePattern.ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (h *ArticleHandler) getCachedThread(feedURL string, now time.Time) (articleThread, bool) {
	h.cacheMu.RLock()
	entry, ok := h.cache[feedURL]
	h.cacheMu.RUnlock()
	if !ok {
		return articleThread{}, false
	}
	if now.After(entry.expiresAt) {
		h.cacheMu.Lock()
		current, exists := h.cache[feedURL]
		if exists && now.After(current.expiresAt) {
			delete(h.cache, feedURL)
		}
		h.cacheMu.Unlock()
		return articleThread{}, false
	}

	return cloneThread(entry.value), true
}

func (h *ArticleHandler) setCachedThread(feedURL string, value articleThread, expiresAt time.Time) {
	h.cacheMu.Lock()
	h.cache[feedURL] = cachedThread{
		value:     cloneThread(value),
		expiresAt: expiresAt,
	}
	h.cacheMu.Unlock()
}

func cloneThread(input articleThread) articleThread {
	output := input
	if input.Comments == nil {
		return output
	}
	output.Comments = make([]articleThreadComment, len(input.Comments))
	copy(output.Comments, input.Comments)
	return output
}

func (h *ArticleHandler) getCachedSummaryPayload(ctx context.Context, articleID uint64) (articleSummaryPayload, bool, error) {
	var cached models.ArticleSummary
	err := h.db.WithContext(ctx).
		Where("article_id = ?", articleID).
		Take(&cached).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return articleSummaryPayload{}, false, nil
		}
		return articleSummaryPayload{}, false, err
	}

	return articleSummaryPayload{
		ArticleID:   articleID,
		Summary:     cached.Summary,
		Model:       cached.Model,
		InputChars:  cached.InputChars,
		Truncated:   cached.Truncated,
		Provider:    cached.Provider,
		GeneratedAt: cached.GeneratedAt,
		CacheHit:    true,
	}, true, nil
}

func parseBoolQuery(raw string) bool {
	value := strings.TrimSpace(raw)
	switch value {
	case "1", "true", "TRUE", "True", "yes", "YES", "Yes", "on", "ON", "On":
		return true
	default:
		return false
	}
}

func buildThreadTrackingSourceName(articleTitle string, fallback string) string {
	title := strings.TrimSpace(articleTitle)
	if title == "" {
		title = strings.TrimSpace(fallback)
	}
	if title == "" {
		title = "Forum Thread"
	}
	if len(title) > 80 {
		title = title[:80]
	}
	return "Thread: " + title
}

func normalizeSiteKeyFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "unknown-site"
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return "unknown-site"
	}
	if host == "rsshub.rssforever.com" {
		segment := strings.TrimSpace(strings.ToLower(firstNonEmpty(strings.Split(strings.Trim(parsed.Path, "/"), "/")...)))
		if segment != "" {
			return segment
		}
	}
	if host == "localhost" {
		return host
	}
	eTLD1, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err == nil && strings.TrimSpace(eTLD1) != "" {
		return strings.ToLower(eTLD1)
	}
	return host
}

func shouldFetchExternalArticle(sourceName string, sourceRSSURL string, link string) bool {
	if !isSafeExternalURL(link) {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return false
	}
	if host == "news.ycombinator.com" || host == "hnrss.org" || host == "rsshub.app" || host == "rsshub.rssforever.com" {
		return false
	}

	sourceHints := strings.ToLower(strings.TrimSpace(sourceName) + " " + strings.TrimSpace(sourceRSSURL))
	if strings.Contains(sourceHints, "hacker news") || strings.Contains(sourceHints, "hn") || strings.Contains(sourceHints, "hnrss") {
		return true
	}
	if strings.Contains(strings.ToLower(strings.TrimSpace(sourceRSSURL)), "hnrss") {
		return true
	}
	return false
}

func isSafeExternalURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return false
	}
	lowerHost := strings.ToLower(host)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".local") {
		return false
	}
	ip := net.ParseIP(lowerHost)
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() {
		return false
	}
	return true
}

func (h *ArticleHandler) fetchExternalArticle(ctx context.Context, articleURL string) (*articleExternalContent, bool) {
	if cached, ok := h.getCachedExternal(articleURL, time.Now().UTC()); ok {
		return &cached, true
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, articleURL, nil)
	if err != nil {
		return nil, false
	}
	req.Header.Set("User-Agent", "quick-external-fetcher/0.1")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, false
	}
	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if !strings.Contains(contentType, "text/html") {
		return nil, false
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, externalMaxBodyBytes))
	if err != nil {
		return nil, false
	}
	external, ok := parseExternalHTML(articleURL, body)
	if !ok {
		return nil, false
	}
	h.setCachedExternal(articleURL, *external, time.Now().UTC().Add(externalCacheTTL))
	return external, true
}

func parseExternalHTML(articleURL string, body []byte) (*articleExternalContent, bool) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil, false
	}

	doc.Find("script,style,noscript,header,footer,nav,aside,form,svg").Each(func(_ int, s *goquery.Selection) {
		s.Remove()
	})

	title := normalizeThreadText(doc.Find("title").First().Text())
	content := extractMainArticleText(doc)
	if content == "" {
		return nil, false
	}

	truncated := false
	if len(content) > externalMaxContentChars {
		content = content[:externalMaxContentChars]
		truncated = true
	}
	if title == "" {
		title = articleURL
	}

	return &articleExternalContent{
		URL:       strings.TrimSpace(articleURL),
		Title:     title,
		Content:   content,
		Truncated: truncated,
	}, true
}

func extractMainArticleText(doc *goquery.Document) string {
	candidates := []string{
		"article",
		"main",
		"[role='main']",
		".post-content",
		".entry-content",
		".article-content",
		".content",
	}
	bestText := ""
	for _, selector := range candidates {
		doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
			text := extractParagraphText(s)
			if len(text) > len(bestText) {
				bestText = text
			}
		})
	}
	if bestText != "" {
		return bestText
	}
	return extractParagraphText(doc.Find("body"))
}

func extractParagraphText(selection *goquery.Selection) string {
	paragraphs := make([]string, 0, 64)
	selection.Find("p").Each(func(_ int, p *goquery.Selection) {
		text := normalizeThreadText(p.Text())
		if len(text) < 20 {
			return
		}
		paragraphs = append(paragraphs, text)
	})
	if len(paragraphs) > 0 {
		return strings.Join(paragraphs, "\n\n")
	}
	return normalizeThreadText(selection.Text())
}

func (h *ArticleHandler) getCachedExternal(articleURL string, now time.Time) (articleExternalContent, bool) {
	h.externalCacheMu.RLock()
	entry, ok := h.externalCache[articleURL]
	h.externalCacheMu.RUnlock()
	if !ok {
		return articleExternalContent{}, false
	}
	if now.After(entry.expiresAt) {
		h.externalCacheMu.Lock()
		current, exists := h.externalCache[articleURL]
		if exists && now.After(current.expiresAt) {
			delete(h.externalCache, articleURL)
		}
		h.externalCacheMu.Unlock()
		return articleExternalContent{}, false
	}
	return entry.value, true
}

func (h *ArticleHandler) setCachedExternal(articleURL string, value articleExternalContent, expiresAt time.Time) {
	h.externalCacheMu.Lock()
	h.externalCache[articleURL] = cachedExternalArticle{
		value:     value,
		expiresAt: expiresAt,
	}
	h.externalCacheMu.Unlock()
}
