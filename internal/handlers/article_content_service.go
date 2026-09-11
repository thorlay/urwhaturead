package handlers

import (
	"bytes"
	"context"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"quick/internal/feedextract"
	"quick/internal/textclean"

	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
)

const (
	threadCacheTTL         = 5 * time.Minute
	threadMaxBodyBytes     = 2 * 1024 * 1024
	threadMaxComments      = 120
	threadMaxContentChars  = 12000
	threadMaxCommentChars  = 1200
	threadReadMoreHintText = "阅读完整话题"

	externalMaxContentChars = 16000
)

const (
	defaultExternalFetchCacheTTL        = 24 * time.Hour
	defaultExternalFetchFailureTTL      = 60 * time.Minute
	defaultExternalFetchMaxBodyBytes    = 3 * 1024 * 1024
	defaultExternalFetchDailyReqLimit   = 500
	defaultExternalFetchDailyByteBudget = 512 * 1024 * 1024
)

var (
	uscardTopicLinkPattern = regexp.MustCompile(`^https?://www\.uscardforum\.com/t/topic/(\d+)(?:/\d+)?/?$`)
	uscardPostLinkPattern  = regexp.MustCompile(`/t/topic/\d+/(\d+)$`)
	v2exReplyLinkPattern   = regexp.MustCompile(`#reply(\d+)$`)
	redditIDPattern        = regexp.MustCompile(`^[a-z0-9]{5,10}$`)
	httpURLPattern         = regexp.MustCompile(`https?://[^\s"'<>]+`)
)

type cachedThread struct {
	value     articleThread
	expiresAt time.Time
}

type cachedExternalArticle struct {
	value     articleExternalContent
	expiresAt time.Time
}

type threadPost struct {
	PostNumber  int
	Author      string
	PublishedAt *time.Time
	Link        string
	Content     string
	Links       []string
}

type forumThreadTarget struct {
	FeedURLs             []string
	TopicURL             string
	DefaultTitle         string
	PostNumberFromItemFn func(itemLink string) int
}

type ArticleContentService struct {
	rssHubBaseURL    string
	threadFailures   map[string]time.Time
	httpClient       *http.Client
	redditHTTPClient *http.Client
	externalClient   *http.Client
	externalReddit   *http.Client
	parser           *gofeed.Parser

	cacheMu sync.RWMutex
	cache   map[string]cachedThread

	externalCacheMu sync.RWMutex
	externalCache   map[string]cachedExternalArticle
	externalFailMu  sync.RWMutex
	externalFail    map[string]time.Time

	externalBudgetMu     sync.Mutex
	externalBudgetDay    string
	externalBudgetReqs   int
	externalBudgetBytes  int64
	externalFetchEnabled bool
	externalAllowHosts   []string
	externalCacheTTL     time.Duration
	externalFailureTTL   time.Duration
	externalMaxBodyBytes int64
	externalDailyReqMax  int
	externalDailyByteMax int64
}

func NewArticleContentService(options ArticleHandlerOptions) *ArticleContentService {
	cacheTTL := options.ExternalFetchCacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultExternalFetchCacheTTL
	}
	failureTTL := options.ExternalFetchFailureTTL
	if failureTTL <= 0 {
		failureTTL = defaultExternalFetchFailureTTL
	}
	maxBodyBytes := options.ExternalFetchMaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = defaultExternalFetchMaxBodyBytes
	}
	dailyReqMax := options.ExternalFetchDailyReqMax
	if dailyReqMax <= 0 {
		dailyReqMax = defaultExternalFetchDailyReqLimit
	}
	dailyByteMax := options.ExternalFetchDailyByteMax
	if dailyByteMax <= 0 {
		dailyByteMax = defaultExternalFetchDailyByteBudget
	}
	enabled := true
	if options.ExternalFetchEnabledSet {
		enabled = options.ExternalFetchEnabled
	}

	return &ArticleContentService{
		rssHubBaseURL:        strings.TrimRight(strings.TrimSpace(options.RSSHubBaseURL), "/"),
		threadFailures:       make(map[string]time.Time),
		httpClient:           newHandlerHTTPClient(12*time.Second, false),
		redditHTTPClient:     newHandlerHTTPClient(12*time.Second, true),
		externalClient:       newPublicHTTPClient(12*time.Second, false),
		externalReddit:       newPublicHTTPClient(12*time.Second, true),
		parser:               gofeed.NewParser(),
		cache:                make(map[string]cachedThread),
		externalCache:        make(map[string]cachedExternalArticle),
		externalFail:         make(map[string]time.Time),
		externalFetchEnabled: enabled,
		externalAllowHosts:   normalizeHostAllowlist(options.ExternalFetchAllowedHosts),
		externalCacheTTL:     cacheTTL,
		externalFailureTTL:   failureTTL,
		externalMaxBodyBytes: maxBodyBytes,
		externalDailyReqMax:  dailyReqMax,
		externalDailyByteMax: dailyByteMax,
	}
}

func (s *ArticleContentService) clientForURL(rawURL string) *http.Client {
	return pickHTTPClientForURL(rawURL, s.httpClient, s.redditHTTPClient)
}

func (s *ArticleContentService) externalClientForURL(rawURL string) *http.Client {
	return pickHTTPClientForURL(rawURL, s.externalClient, s.externalReddit)
}

func (s *ArticleContentService) fetchThreadForTopic(ctx context.Context, topicLink string) (*articleThread, bool) {
	target, ok := forumThreadTargetFromLink(topicLink)
	if !ok {
		return nil, false
	}

	if _, topicURL, isV2EX := v2exTopicRSSURLs(topicLink); isV2EX && s.rssHubBaseURL != "" {
		target.FeedURLs = []string{s.rssHubBaseURL + "/v2ex/post/" + strings.TrimPrefix(topicURL, "https://www.v2ex.com/t/")}
	}
	for _, feedURL := range target.FeedURLs {
		if cached, ok := s.getCachedThread(feedURL, time.Now().UTC()); ok {
			return &cached, true
		}

		s.cacheMu.Lock()
		retryAt := s.threadFailures[feedURL]
		if !time.Now().Before(retryAt) {
			delete(s.threadFailures, feedURL)
		}
		s.cacheMu.Unlock()
		if time.Now().Before(retryAt) {
			continue
		}
		thread, err := s.fetchThreadFromFeedURL(ctx, target, feedURL)
		if err != nil {
			if ctx.Err() == nil {
				s.cacheMu.Lock()
				s.threadFailures[feedURL] = time.Now().Add(time.Minute)
				s.cacheMu.Unlock()
			}
			continue
		}

		s.setCachedThread(feedURL, *thread, time.Now().UTC().Add(threadCacheTTL))
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

	feedURLs, topicURL, ok = redditTopicRSSURLs(rawLink)
	if ok {
		return forumThreadTarget{
			FeedURLs:             feedURLs,
			TopicURL:             topicURL,
			DefaultTitle:         "Reddit 帖子",
			PostNumberFromItemFn: redditPostNumberFromLink,
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

func redditTopicRSSURLs(rawLink string) (feedURLs []string, topicURL string, ok bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawLink))
	if err != nil {
		return nil, "", false
	}

	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return nil, "", false
	}

	postID := ""
	subreddit := ""
	pathParts := splitPathSegments(parsed.Path)

	if isRedditShortHost(host) {
		if len(pathParts) < 1 {
			return nil, "", false
		}
		postID = normalizeRedditID(pathParts[0])
	} else if isRedditHost(host) {
		if len(pathParts) >= 4 && pathParts[0] == "r" && pathParts[2] == "comments" {
			subreddit = strings.TrimSpace(pathParts[1])
			postID = normalizeRedditID(pathParts[3])
		} else if len(pathParts) >= 2 && pathParts[0] == "comments" {
			postID = normalizeRedditID(pathParts[1])
		}
	}

	if postID == "" {
		return nil, "", false
	}

	feedCandidates := make([]string, 0, 2)
	if subreddit != "" {
		topicURL = "https://www.reddit.com/r/" + subreddit + "/comments/" + postID
		feedCandidates = append(feedCandidates, topicURL+"/.rss")
	} else {
		topicURL = "https://www.reddit.com/comments/" + postID
	}
	feedCandidates = append(feedCandidates, "https://www.reddit.com/comments/"+postID+"/.rss")

	feedURLs = uniqueNonEmptyStrings(feedCandidates)
	if len(feedURLs) == 0 {
		return nil, "", false
	}
	return feedURLs, topicURL, true
}

func mapThreadPost(item *gofeed.Item, postNumberFromLinkFn func(string) int) (threadPost, bool) {
	if item == nil {
		return threadPost{}, false
	}

	link := strings.TrimSpace(item.Link)
	if link == "" {
		return threadPost{}, false
	}

	rawBody := firstNonEmpty(item.Content, item.Description)
	content := normalizeThreadText(rawBody)
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
		Links:       collectThreadPostLinks(rawBody, link),
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

func redditPostNumberFromLink(link string) int {
	parsed, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return 0
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if !isRedditHost(host) && !isRedditShortHost(host) {
		return 0
	}

	if isRedditShortHost(host) {
		return 1
	}

	parts := splitPathSegments(parsed.Path)
	if len(parts) >= 4 && parts[0] == "r" && parts[2] == "comments" {
		if len(parts) >= 6 && normalizeRedditID(parts[5]) != "" {
			return 2
		}
		return 1
	}
	if len(parts) >= 2 && parts[0] == "comments" {
		if len(parts) >= 3 && normalizeRedditID(parts[2]) != "" {
			return 2
		}
		return 1
	}
	return 0
}

func normalizeThreadText(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, threadReadMoreHintText, " ")
	return textclean.NormalizeFromHTMLBlock(value)
}

func splitPathSegments(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.ToLower(strings.TrimSpace(part))
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func normalizeRedditID(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if !redditIDPattern.MatchString(value) {
		return ""
	}
	return value
}

func isRedditHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "reddit.com", "www.reddit.com", "old.reddit.com", "np.reddit.com":
		return true
	default:
		return false
	}
}

func isRedditShortHost(host string) bool {
	return strings.EqualFold(strings.TrimSpace(host), "redd.it")
}

func uniqueNonEmptyStrings(input []string) []string {
	seen := make(map[string]struct{}, len(input))
	out := make([]string, 0, len(input))
	for _, raw := range input {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (s *ArticleContentService) fetchThreadFromFeedURL(ctx context.Context, target forumThreadTarget, feedURL string) (*articleThread, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "quick-thread-fetcher/0.1")

	resp, err := s.clientForURL(feedURL).Do(req)
	logRedditHTTPResult("article.fetchThreadFeed", feedURL, resp, err)
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

	feed, err := s.parser.Parse(bytes.NewReader(feedextract.SanitizeXML10(body)))
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
	if externalLink := pickThreadExternalLink(posts[firstIndex], target.TopicURL, feedURL); externalLink != "" {
		thread.ExternalLink = stringPtr(externalLink)
	}
	if thread.TopicTitle == "" {
		thread.TopicTitle = target.DefaultTitle
	}

	return &thread, nil
}

func (s *ArticleContentService) getCachedThread(feedURL string, now time.Time) (articleThread, bool) {
	s.cacheMu.RLock()
	entry, ok := s.cache[feedURL]
	s.cacheMu.RUnlock()
	if !ok {
		return articleThread{}, false
	}
	if now.After(entry.expiresAt) {
		s.cacheMu.Lock()
		current, exists := s.cache[feedURL]
		if exists && now.After(current.expiresAt) {
			delete(s.cache, feedURL)
		}
		s.cacheMu.Unlock()
		return articleThread{}, false
	}

	return cloneThread(entry.value), true
}

func (s *ArticleContentService) setCachedThread(feedURL string, value articleThread, expiresAt time.Time) {
	s.cacheMu.Lock()
	s.cache[feedURL] = cachedThread{
		value:     cloneThread(value),
		expiresAt: expiresAt,
	}
	s.cacheMu.Unlock()
}

func cloneThread(input articleThread) articleThread {
	output := input
	if input.ExternalLink != nil {
		value := strings.TrimSpace(*input.ExternalLink)
		output.ExternalLink = &value
	}
	if input.Comments == nil {
		return output
	}
	output.Comments = make([]articleThreadComment, len(input.Comments))
	copy(output.Comments, input.Comments)
	return output
}

func (s *ArticleContentService) fetchExternalArticle(ctx context.Context, articleURL string) (*articleExternalContent, bool) {
	now := time.Now().UTC()
	normalizedURL := strings.TrimSpace(articleURL)
	if normalizedURL == "" {
		return nil, false
	}
	if !s.externalFetchEnabled || !isSafeExternalURL(normalizedURL) {
		return nil, false
	}

	parsed, err := url.Parse(normalizedURL)
	if err != nil {
		return nil, false
	}
	if err := validatePublicURLSyntax(parsed); err != nil {
		return nil, false
	}
	host := normalizeHost(parsed.Hostname())
	if host == "" || !s.isExternalHostAllowed(host) {
		return nil, false
	}
	if s.isExternalFailureCached(normalizedURL, now) {
		return nil, false
	}
	if cached, ok := s.getCachedExternal(normalizedURL, now); ok {
		return &cached, true
	}
	if !s.consumeExternalBudgetRequest(now) {
		s.setExternalFailure(normalizedURL, now)
		return nil, false
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalizedURL, nil)
	if err != nil {
		s.setExternalFailure(normalizedURL, now)
		return nil, false
	}
	req.Header.Set("User-Agent", "quick-external-fetcher/0.1")

	resp, err := s.externalClientForURL(normalizedURL).Do(req)
	logRedditHTTPResult("article.fetchExternal", normalizedURL, resp, err)
	if err != nil {
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}
	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if !strings.Contains(contentType, "text/html") {
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}

	bodyLimit := s.externalMaxBodyBytes
	if bodyLimit <= 0 {
		bodyLimit = defaultExternalFetchMaxBodyBytes
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, bodyLimit+1))
	if err != nil {
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}
	if int64(len(body)) > bodyLimit {
		s.consumeExternalBudgetBytes(time.Now().UTC(), bodyLimit)
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}
	s.consumeExternalBudgetBytes(time.Now().UTC(), int64(len(body)))

	external, ok := parseExternalHTML(normalizedURL, body)
	if !ok {
		s.setExternalFailure(normalizedURL, time.Now().UTC())
		return nil, false
	}
	s.clearExternalFailure(normalizedURL)
	s.setCachedExternal(normalizedURL, *external, time.Now().UTC().Add(s.externalCacheTTL))
	return external, true
}

func (s *ArticleContentService) getCachedExternal(articleURL string, now time.Time) (articleExternalContent, bool) {
	s.externalCacheMu.RLock()
	entry, ok := s.externalCache[articleURL]
	s.externalCacheMu.RUnlock()
	if !ok {
		return articleExternalContent{}, false
	}
	if now.After(entry.expiresAt) {
		s.externalCacheMu.Lock()
		current, exists := s.externalCache[articleURL]
		if exists && now.After(current.expiresAt) {
			delete(s.externalCache, articleURL)
		}
		s.externalCacheMu.Unlock()
		return articleExternalContent{}, false
	}
	return entry.value, true
}

func (s *ArticleContentService) setCachedExternal(articleURL string, value articleExternalContent, expiresAt time.Time) {
	s.externalCacheMu.Lock()
	s.externalCache[articleURL] = cachedExternalArticle{
		value:     value,
		expiresAt: expiresAt,
	}
	s.externalCacheMu.Unlock()
}

func (s *ArticleContentService) isExternalHostAllowed(host string) bool {
	rules := s.externalAllowHosts
	if len(rules) == 0 {
		return true
	}
	for _, rule := range rules {
		if hostMatchesAllowRule(host, rule) {
			return true
		}
	}
	return false
}

func (s *ArticleContentService) isExternalFailureCached(articleURL string, now time.Time) bool {
	ttl := s.externalFailureTTL
	if ttl <= 0 {
		return false
	}
	s.externalFailMu.RLock()
	expiresAt, ok := s.externalFail[articleURL]
	s.externalFailMu.RUnlock()
	if !ok {
		return false
	}
	if now.Before(expiresAt) {
		return true
	}
	s.externalFailMu.Lock()
	current, exists := s.externalFail[articleURL]
	if exists && now.After(current) {
		delete(s.externalFail, articleURL)
	}
	s.externalFailMu.Unlock()
	return false
}

func (s *ArticleContentService) setExternalFailure(articleURL string, now time.Time) {
	ttl := s.externalFailureTTL
	if ttl <= 0 {
		return
	}
	s.externalFailMu.Lock()
	s.externalFail[articleURL] = now.Add(ttl)
	s.externalFailMu.Unlock()
}

func (s *ArticleContentService) clearExternalFailure(articleURL string) {
	s.externalFailMu.Lock()
	delete(s.externalFail, articleURL)
	s.externalFailMu.Unlock()
}

func (s *ArticleContentService) consumeExternalBudgetRequest(now time.Time) bool {
	s.externalBudgetMu.Lock()
	defer s.externalBudgetMu.Unlock()

	s.resetExternalBudgetLocked(now)
	if s.externalDailyReqMax > 0 && s.externalBudgetReqs >= s.externalDailyReqMax {
		return false
	}
	if s.externalDailyByteMax > 0 && s.externalBudgetBytes >= s.externalDailyByteMax {
		return false
	}
	s.externalBudgetReqs++
	return true
}

func (s *ArticleContentService) consumeExternalBudgetBytes(now time.Time, bodyBytes int64) {
	if bodyBytes <= 0 {
		return
	}
	s.externalBudgetMu.Lock()
	s.resetExternalBudgetLocked(now)
	s.externalBudgetBytes += bodyBytes
	s.externalBudgetMu.Unlock()
}

func (s *ArticleContentService) resetExternalBudgetLocked(now time.Time) {
	day := now.UTC().Format("2006-01-02")
	if s.externalBudgetDay == day {
		return
	}
	s.externalBudgetDay = day
	s.externalBudgetReqs = 0
	s.externalBudgetBytes = 0
}

func collectThreadPostLinks(rawBody string, itemLink string) []string {
	links := make([]string, 0, 8)
	if trimmed := strings.TrimSpace(itemLink); trimmed != "" {
		links = append(links, trimmed)
	}

	body := strings.TrimSpace(rawBody)
	if body != "" {
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(body))
		if err == nil {
			doc.Find("a[href]").Each(func(_ int, anchor *goquery.Selection) {
				href, exists := anchor.Attr("href")
				if !exists {
					return
				}
				href = strings.TrimSpace(html.UnescapeString(href))
				if strings.HasPrefix(href, "//") {
					href = "https:" + href
				}
				links = append(links, href)
			})
		}

		matches := httpURLPattern.FindAllString(body, -1)
		links = append(links, matches...)
	}

	return uniqueNonEmptyStrings(links)
}

func pickThreadExternalLink(post threadPost, topicURL string, feedURL string) string {
	blocked := make([]string, 0, 4)
	if value := strings.TrimSpace(topicURL); value != "" {
		blocked = append(blocked, value)
	}
	if value := strings.TrimSpace(feedURL); value != "" {
		blocked = append(blocked, value)
	}
	if value := strings.TrimSpace(post.Link); value != "" {
		blocked = append(blocked, value)
	}

	for _, raw := range post.Links {
		candidate := strings.TrimSpace(raw)
		if candidate == "" {
			continue
		}
		if !isSafeExternalURL(candidate) {
			continue
		}
		if isForumInternalURL(candidate) {
			continue
		}
		if inBlockedURLPrefix(candidate, blocked) {
			continue
		}
		return candidate
	}
	return ""
}

func isForumInternalURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return true
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return true
	}
	if isRedditHost(host) || isRedditShortHost(host) {
		return true
	}
	return host == "www.uscardforum.com" ||
		host == "uscardforum.com" ||
		host == "www.v2ex.com" ||
		host == "v2ex.com" ||
		host == "news.ycombinator.com" ||
		host == "hnrss.org" ||
		host == "rsshub.app" ||
		host == "rsshub.rssforever.com"
}

func inBlockedURLPrefix(candidate string, blocked []string) bool {
	candidate = strings.TrimRight(strings.TrimSpace(candidate), "/")
	for _, raw := range blocked {
		base := strings.TrimRight(strings.TrimSpace(raw), "/")
		if base == "" {
			continue
		}
		if candidate == base || strings.HasPrefix(candidate, base+"/") {
			return true
		}
	}
	return false
}

func stringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
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

func normalizeHostAllowlist(hosts []string) []string {
	if len(hosts) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(hosts))
	out := make([]string, 0, len(hosts))
	for _, raw := range hosts {
		value := strings.ToLower(strings.TrimSpace(raw))
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
			if parsed, err := url.Parse(value); err == nil {
				value = normalizeHost(parsed.Hostname())
			}
		} else if strings.HasSuffix(value, "/") {
			value = strings.TrimRight(value, "/")
		}
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func normalizeHost(host string) string {
	return strings.Trim(strings.ToLower(strings.TrimSpace(host)), ".")
}

func hostMatchesAllowRule(host string, rule string) bool {
	host = normalizeHost(host)
	rule = normalizeHost(rule)
	if host == "" || rule == "" {
		return false
	}
	if strings.HasPrefix(rule, "*.") {
		base := normalizeHost(strings.TrimPrefix(rule, "*."))
		return base != "" && strings.HasSuffix(host, "."+base)
	}
	if host == rule {
		return true
	}
	return strings.HasSuffix(host, "."+rule)
}
