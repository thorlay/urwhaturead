package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"

	"quick/internal/clustering"
	"quick/internal/feedextract"
	"quick/internal/models"
	"quick/internal/textclean"

	"github.com/mmcdole/gofeed"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var (
	ErrSourceBusy     = errors.New("source fetch already in progress")
	ErrSourceDisabled = errors.New("source is disabled")
)

type Refresher interface {
	RefreshSource(ctx context.Context, sourceID uint64) error
}

type RSSWorkerOptions struct {
	TickSec          int
	RequestRetries   int
	RetryBaseSec     int
	BackoffMaxFactor int
	UserAgent        string
	DebugHTTP        bool
	DebugHosts       []string
}

type RSSWorker struct {
	db               *gorm.DB
	tick             time.Duration
	httpClient       *http.Client
	redditHTTPClient *http.Client
	parser           *gofeed.Parser
	inflight         sync.Map
	requestRetries   int
	retryBaseDelay   time.Duration
	backoffMaxFactor int
	userAgent        string
	debugHTTP        bool
	debugHosts       []string
}

type fetchResult struct {
	HTTPStatus   int
	ETag         *string
	LastModified *string
	Body         []byte
	NotModified  bool
}

type fetchError struct {
	Message      string
	StatusCode   int
	ETag         *string
	LastModified *string
	Retryable    bool
}

func (e fetchError) Error() string {
	return e.Message
}

func NewRSSWorker(db *gorm.DB, options RSSWorkerOptions) *RSSWorker {
	if options.TickSec <= 0 {
		options.TickSec = 30
	}
	if options.RequestRetries < 0 {
		options.RequestRetries = 0
	}
	if options.RetryBaseSec <= 0 {
		options.RetryBaseSec = 2
	}
	if options.BackoffMaxFactor < 1 {
		options.BackoffMaxFactor = 16
	}
	if strings.TrimSpace(options.UserAgent) == "" {
		options.UserAgent = "quick-rss-worker/0.1"
	}

	return &RSSWorker{
		db:               db,
		tick:             time.Duration(options.TickSec) * time.Second,
		requestRetries:   options.RequestRetries,
		retryBaseDelay:   time.Duration(options.RetryBaseSec) * time.Second,
		backoffMaxFactor: options.BackoffMaxFactor,
		userAgent:        strings.TrimSpace(options.UserAgent),
		debugHTTP:        options.DebugHTTP,
		debugHosts:       normalizeDebugHosts(options.DebugHosts),
		httpClient:       newHTTPClient(false),
		redditHTTPClient: newHTTPClient(true),
		parser:           gofeed.NewParser(),
	}
}

func newHTTPClient(disableHTTP2 bool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if disableHTTP2 {
		transport.ForceAttemptHTTP2 = false
		transport.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
		tlsConfig := transport.TLSClientConfig
		if tlsConfig != nil {
			tlsConfig = tlsConfig.Clone()
		} else {
			tlsConfig = &tls.Config{}
		}
		// Force ALPN to HTTP/1.1 so upstream cannot negotiate h2.
		tlsConfig.NextProtos = []string{"http/1.1"}
		transport.TLSClientConfig = tlsConfig
	}
	return &http.Client{
		Timeout:   12 * time.Second,
		Transport: transport,
	}
}

func (w *RSSWorker) clientForURL(rawURL string) *http.Client {
	if isRedditRSSURL(rawURL) && w.redditHTTPClient != nil {
		return w.redditHTTPClient
	}
	return w.httpClient
}

func (w *RSSWorker) Start(ctx context.Context) {
	log.Printf("rss worker started; tick=%s", w.tick)
	w.runOnce(ctx)

	ticker := time.NewTicker(w.tick)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("rss worker stopped")
			return
		case <-ticker.C:
			w.runOnce(ctx)
		}
	}
}

func (w *RSSWorker) runOnce(ctx context.Context) {
	now := time.Now()

	var sources []models.Source
	if err := w.db.WithContext(ctx).
		Where("enabled = ?", true).
		Find(&sources).Error; err != nil {
		log.Printf("worker query sources failed: %v", err)
		return
	}

	for _, source := range sources {
		if !w.isDue(source, now) {
			continue
		}
		if err := w.fetchSource(ctx, source); err != nil && !errors.Is(err, ErrSourceBusy) {
			log.Printf("worker fetch source=%d failed: %v", source.ID, err)
		}
	}
}

func (w *RSSWorker) RefreshSource(ctx context.Context, sourceID uint64) error {
	var source models.Source
	if err := w.db.WithContext(ctx).First(&source, sourceID).Error; err != nil {
		return err
	}
	if !source.Enabled {
		return ErrSourceDisabled
	}

	return w.fetchSource(ctx, source)
}

func (w *RSSWorker) fetchSource(ctx context.Context, source models.Source) error {
	if _, loaded := w.inflight.LoadOrStore(source.ID, struct{}{}); loaded {
		return ErrSourceBusy
	}
	defer w.inflight.Delete(source.ID)

	startedAt := time.Now()
	fetchLog := &models.SourceFetchLog{
		SourceID:  source.ID,
		FetchedAt: startedAt,
		Status:    "failed",
		ItemCount: 0,
	}
	defer func() {
		duration := int(time.Since(startedAt).Milliseconds())
		fetchLog.DurationMS = &duration
		if err := w.db.WithContext(ctx).Create(fetchLog).Error; err != nil {
			log.Printf("create fetch log failed for source=%d: %v", source.ID, err)
		}
	}()

	result, err := w.fetchWithRetry(ctx, source)
	if err != nil {
		message := err.Error()
		fetchLog.ErrorMessage = &message

		var ferr fetchError
		if errors.As(err, &ferr) {
			if ferr.StatusCode > 0 {
				statusCode := ferr.StatusCode
				fetchLog.HTTPStatus = &statusCode
			}
			if markErr := w.markSourceFailure(ctx, source.ID, time.Now(), ferr.ETag, ferr.LastModified, message); markErr != nil {
				log.Printf("mark source failure failed for source=%d: %v", source.ID, markErr)
			}
		} else {
			if markErr := w.markSourceFailure(ctx, source.ID, time.Now(), nil, nil, message); markErr != nil {
				log.Printf("mark source failure failed for source=%d: %v", source.ID, markErr)
			}
		}
		return err
	}

	if result.HTTPStatus > 0 {
		statusCode := result.HTTPStatus
		fetchLog.HTTPStatus = &statusCode
	}

	if result.NotModified {
		fetchLog.Status = "not_modified"
		if err := w.markSourceSuccess(ctx, source.ID, time.Now(), result.ETag, result.LastModified); err != nil {
			message := fmt.Sprintf("update source state failed: %v", err)
			fetchLog.ErrorMessage = &message
			return err
		}
		return nil
	}

	feed, err := w.parser.Parse(bytes.NewReader(feedextract.SanitizeXML10(result.Body)))
	if err != nil {
		message := fmt.Sprintf("parse feed failed: %v", err)
		fetchLog.ErrorMessage = &message
		_ = w.markSourceFailure(ctx, source.ID, time.Now(), result.ETag, result.LastModified, message)
		return err
	}

	inserted := 0
	for _, item := range feed.Items {
		article, ok := mapFeedItemToArticle(source.ID, item)
		if !ok {
			continue
		}
		saved, saveErr := w.saveArticleIfNew(ctx, article)
		if saveErr != nil {
			message := fmt.Sprintf("save article failed: %v", saveErr)
			fetchLog.ErrorMessage = &message
			_ = w.markSourceFailure(ctx, source.ID, time.Now(), result.ETag, result.LastModified, message)
			return saveErr
		}
		if saved {
			inserted++
		}
	}

	fetchLog.Status = "success"
	fetchLog.ItemCount = inserted
	if err := w.markSourceSuccess(ctx, source.ID, time.Now(), result.ETag, result.LastModified); err != nil {
		message := fmt.Sprintf("update source state failed: %v", err)
		fetchLog.ErrorMessage = &message
		return err
	}

	return nil
}

func (w *RSSWorker) isDue(source models.Source, now time.Time) bool {
	if source.LastFetchedAt == nil {
		return true
	}
	effectiveInterval := effectivePollInterval(source.PollIntervalSec, source.ConsecutiveFailures, w.backoffMaxFactor)
	return !source.LastFetchedAt.Add(effectiveInterval).After(now)
}

func cleanHeader(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (w *RSSWorker) fetchWithRetry(ctx context.Context, source models.Source) (*fetchResult, error) {
	attempts := retryAttemptsForSource(w.requestRetries, source.RSSURL)
	var lastErr error

	for attempt := 1; attempt <= attempts; attempt++ {
		result, err := w.fetchOnce(ctx, source)
		if err == nil {
			return result, nil
		}
		lastErr = err

		var ferr fetchError
		if !errors.As(err, &ferr) || !ferr.Retryable || attempt == attempts {
			return nil, err
		}

		wait := w.retryBaseDelay * time.Duration(1<<(attempt-1))
		log.Printf(
			"worker source=%d attempt=%d/%d failed (%v), retry in %s",
			source.ID,
			attempt,
			attempts,
			err,
			wait,
		)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}

	return nil, lastErr
}

func (w *RSSWorker) fetchOnce(ctx context.Context, source models.Source) (*fetchResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.RSSURL, nil)
	if err != nil {
		return nil, fetchError{
			Message:   fmt.Sprintf("build request failed: %v", err),
			Retryable: false,
		}
	}
	req.Header.Set("User-Agent", w.userAgent)
	if isRedditRSSURL(source.RSSURL) {
		req.Header.Set("Accept", "application/atom+xml,application/rss+xml,text/xml;q=0.9,*/*;q=0.8")
	}

	if source.ETag != nil && strings.TrimSpace(*source.ETag) != "" {
		req.Header.Set("If-None-Match", *source.ETag)
	}
	if source.LastModified != nil && strings.TrimSpace(*source.LastModified) != "" {
		req.Header.Set("If-Modified-Since", *source.LastModified)
	}
	if w.shouldDebugURL(source.RSSURL) {
		log.Printf(
			"worker debug request source=%d url=%s ua=%q accept=%q referer=%q if_none_match=%q if_modified_since=%q",
			source.ID,
			source.RSSURL,
			req.Header.Get("User-Agent"),
			req.Header.Get("Accept"),
			req.Header.Get("Referer"),
			req.Header.Get("If-None-Match"),
			req.Header.Get("If-Modified-Since"),
		)
	}

	resp, err := w.clientForURL(source.RSSURL).Do(req)
	w.logRedditHTTPResult("worker.fetchOnce", source.RSSURL, resp, err)
	if err != nil {
		return nil, fetchError{
			Message:   fmt.Sprintf("request failed: %v", err),
			Retryable: true,
		}
	}
	defer resp.Body.Close()

	etag := cleanHeader(resp.Header.Get("ETag"))
	lastModified := cleanHeader(resp.Header.Get("Last-Modified"))
	if w.shouldDebugURL(source.RSSURL) {
		log.Printf(
			"worker debug response source=%d url=%s status=%d retry_after=%q ratelimit_used=%q ratelimit_remaining=%q cache_control=%q content_type=%q etag=%q last_modified=%q",
			source.ID,
			source.RSSURL,
			resp.StatusCode,
			resp.Header.Get("Retry-After"),
			resp.Header.Get("X-Ratelimit-Used"),
			resp.Header.Get("X-Ratelimit-Remaining"),
			resp.Header.Get("Cache-Control"),
			resp.Header.Get("Content-Type"),
			resp.Header.Get("ETag"),
			resp.Header.Get("Last-Modified"),
		)
	}

	if resp.StatusCode == http.StatusNotModified {
		return &fetchResult{
			HTTPStatus:   resp.StatusCode,
			ETag:         etag,
			LastModified: lastModified,
			NotModified:  true,
		}, nil
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fetchError{
			Message:      fmt.Sprintf("unexpected status code: %d", resp.StatusCode),
			StatusCode:   resp.StatusCode,
			ETag:         etag,
			LastModified: lastModified,
			Retryable:    resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError,
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fetchError{
			Message:      fmt.Sprintf("read response failed: %v", err),
			StatusCode:   resp.StatusCode,
			ETag:         etag,
			LastModified: lastModified,
			Retryable:    true,
		}
	}
	if ok, reason := validateFeedResponse(resp.Header.Get("Content-Type"), body); !ok {
		if w.shouldDebugURL(source.RSSURL) {
			log.Printf(
				"worker debug non-feed response source=%d url=%s status=%d reason=%q body_snippet=%q",
				source.ID,
				source.RSSURL,
				resp.StatusCode,
				reason,
				bodySnippet(body, 2000),
			)
		}
		return nil, fetchError{
			Message:      "blocked or non-feed response: " + reason,
			StatusCode:   resp.StatusCode,
			ETag:         etag,
			LastModified: lastModified,
			Retryable:    false,
		}
	}

	return &fetchResult{
		HTTPStatus:   resp.StatusCode,
		ETag:         etag,
		LastModified: lastModified,
		Body:         body,
	}, nil
}

func (w *RSSWorker) fetchRedditFallbackOnce(ctx context.Context, fallbackURL string, source models.Source) (*fetchResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fallbackURL, nil)
	if err != nil {
		return nil, fetchError{Message: fmt.Sprintf("build fallback request failed: %v", err), Retryable: false}
	}
	req.Header.Set("User-Agent", w.userAgent)
	req.Header.Set("Accept", "application/atom+xml,application/rss+xml,text/xml;q=0.9,*/*;q=0.8")
	if source.ETag != nil && strings.TrimSpace(*source.ETag) != "" {
		req.Header.Set("If-None-Match", *source.ETag)
	}
	if source.LastModified != nil && strings.TrimSpace(*source.LastModified) != "" {
		req.Header.Set("If-Modified-Since", *source.LastModified)
	}
	if w.shouldDebugURL(fallbackURL) {
		log.Printf(
			"worker debug fallback request url=%s ua=%q accept=%q referer=%q if_none_match=%q if_modified_since=%q",
			fallbackURL,
			req.Header.Get("User-Agent"),
			req.Header.Get("Accept"),
			req.Header.Get("Referer"),
			req.Header.Get("If-None-Match"),
			req.Header.Get("If-Modified-Since"),
		)
	}

	resp, err := w.clientForURL(fallbackURL).Do(req)
	w.logRedditHTTPResult("worker.fetchFallback", fallbackURL, resp, err)
	if err != nil {
		return nil, fetchError{Message: fmt.Sprintf("fallback request failed: %v", err), Retryable: false}
	}
	defer resp.Body.Close()
	if w.shouldDebugURL(fallbackURL) {
		log.Printf(
			"worker debug fallback response url=%s status=%d retry_after=%q ratelimit_used=%q ratelimit_remaining=%q cache_control=%q content_type=%q etag=%q last_modified=%q",
			fallbackURL,
			resp.StatusCode,
			resp.Header.Get("Retry-After"),
			resp.Header.Get("X-Ratelimit-Used"),
			resp.Header.Get("X-Ratelimit-Remaining"),
			resp.Header.Get("Cache-Control"),
			resp.Header.Get("Content-Type"),
			resp.Header.Get("ETag"),
			resp.Header.Get("Last-Modified"),
		)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fetchError{
			Message:    fmt.Sprintf("fallback unexpected status code: %d", resp.StatusCode),
			StatusCode: resp.StatusCode,
			Retryable:  false,
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fetchError{
			Message:    fmt.Sprintf("fallback read response failed: %v", err),
			StatusCode: resp.StatusCode,
			Retryable:  false,
		}
	}

	return &fetchResult{
		HTTPStatus:   resp.StatusCode,
		ETag:         cleanHeader(resp.Header.Get("ETag")),
		LastModified: cleanHeader(resp.Header.Get("Last-Modified")),
		Body:         body,
	}, nil
}

func effectivePollInterval(pollIntervalSec int, consecutiveFailures int, maxBackoffFactor int) time.Duration {
	if pollIntervalSec <= 0 {
		pollIntervalSec = 900
	}

	factor := effectiveBackoffFactor(consecutiveFailures, maxBackoffFactor)
	return time.Duration(pollIntervalSec*factor) * time.Second
}

func effectiveBackoffFactor(consecutiveFailures int, maxFactor int) int {
	if consecutiveFailures <= 0 || maxFactor <= 1 {
		return 1
	}

	factor := 1
	for i := 0; i < consecutiveFailures; i++ {
		if factor >= maxFactor {
			return maxFactor
		}
		factor *= 2
		if factor > maxFactor {
			return maxFactor
		}
	}
	return factor
}

func retryAttemptsForSource(defaultRetries int, rssURL string) int {
	attempts := defaultRetries + 1
	if attempts < 1 {
		attempts = 1
	}
	// Reddit applies aggressive bot/rate limiting; avoid burst retries that often amplify 429s.
	if isRedditRSSURL(rssURL) {
		return 1
	}
	return attempts
}

func normalizeDebugHosts(rawHosts []string) []string {
	if len(rawHosts) == 0 {
		return nil
	}
	out := make([]string, 0, len(rawHosts))
	seen := make(map[string]struct{}, len(rawHosts))
	for _, raw := range rawHosts {
		host := strings.TrimSpace(strings.ToLower(raw))
		if host == "" {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}
	return out
}

func (w *RSSWorker) shouldDebugURL(rawURL string) bool {
	if !w.debugHTTP {
		return false
	}
	if len(w.debugHosts) == 0 {
		return true
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" {
		return false
	}
	for _, rule := range w.debugHosts {
		if host == rule || strings.HasSuffix(host, "."+rule) {
			return true
		}
	}
	return false
}

func (w *RSSWorker) logRedditHTTPResult(scope string, rawURL string, resp *http.Response, err error) {
	if !isRedditRSSURL(rawURL) {
		return
	}
	if err != nil {
		log.Printf("%s reddit request failed url=%s err=%v", scope, rawURL, err)
		return
	}
	if resp == nil {
		log.Printf("%s reddit response is nil url=%s", scope, rawURL)
		return
	}
	alpn := ""
	if resp.TLS != nil {
		alpn = strings.TrimSpace(resp.TLS.NegotiatedProtocol)
	}
	finalURL := rawURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	log.Printf(
		"%s reddit response url=%s final_url=%s status=%d proto=%s alpn=%q",
		scope,
		rawURL,
		finalURL,
		resp.StatusCode,
		resp.Proto,
		alpn,
	)
}

func isRedditRSSURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	switch host {
	case "www.reddit.com", "reddit.com", "old.reddit.com":
		return true
	default:
		return false
	}
}

func validateFeedResponse(contentType string, body []byte) (bool, string) {
	if looksLikeFeedBody(body) {
		return true, ""
	}

	if isLikelyFeedContentType(contentType) {
		return false, "content-type looks like feed but body is not rss/atom/xml"
	}
	if looksLikeHTMLBody(body) {
		return false, "html response (likely blocked/challenge page)"
	}

	ct := strings.TrimSpace(contentType)
	if ct == "" {
		return false, "missing content-type and body is not rss/atom/xml"
	}
	return false, "unexpected content-type " + ct
}

func isLikelyFeedContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if ct == "" {
		return false
	}
	if idx := strings.Index(ct, ";"); idx >= 0 {
		ct = strings.TrimSpace(ct[:idx])
	}

	switch ct {
	case "application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "application/rdf+xml":
		return true
	default:
		return false
	}
}

func looksLikeFeedBody(body []byte) bool {
	head := normalizedPrefix(body, 256)
	return strings.HasPrefix(head, "<?xml") ||
		strings.HasPrefix(head, "<rss") ||
		strings.HasPrefix(head, "<feed") ||
		strings.HasPrefix(head, "<rdf:rdf")
}

func looksLikeHTMLBody(body []byte) bool {
	head := normalizedPrefix(body, 256)
	return strings.HasPrefix(head, "<!doctype html") || strings.HasPrefix(head, "<html")
}

func normalizedPrefix(body []byte, max int) string {
	if max <= 0 {
		max = 256
	}
	if len(body) > max {
		body = body[:max]
	}
	text := strings.TrimSpace(string(body))
	text = strings.TrimLeftFunc(text, unicode.IsSpace)
	text = strings.TrimPrefix(text, "\ufeff")
	return strings.ToLower(text)
}

func bodySnippet(body []byte, max int) string {
	if max <= 0 {
		max = 2000
	}
	text := string(body)
	if len(text) > max {
		text = text[:max]
	}
	text = strings.ReplaceAll(text, "\n", " ")
	text = strings.ReplaceAll(text, "\r", " ")
	text = strings.TrimSpace(text)
	return text
}

func redditFallbackURL(rawURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", false
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	switch host {
	case "www.reddit.com", "reddit.com":
		parsed.Host = strings.Replace(parsed.Host, parsed.Hostname(), "old.reddit.com", 1)
		return parsed.String(), true
	default:
		return "", false
	}
}

func mapFeedItemToArticle(sourceID uint64, item *gofeed.Item) (models.Article, bool) {
	link := strings.TrimSpace(item.Link)
	if link == "" {
		return models.Article{}, false
	}

	title := textclean.NormalizeInline(item.Title)
	if title == "" {
		title = link
	}

	summary := firstNonEmpty(
		textclean.NormalizeFromHTML(item.Description),
		textclean.NormalizeFromHTML(item.Content),
	)
	content := textclean.NormalizeFromHTMLBlock(item.Content)
	author := ""
	if item.Author != nil {
		author = textclean.NormalizeInline(item.Author.Name)
	}

	var publishedAt *time.Time
	if item.PublishedParsed != nil {
		value := item.PublishedParsed.UTC()
		publishedAt = &value
	} else if item.UpdatedParsed != nil {
		value := item.UpdatedParsed.UTC()
		publishedAt = &value
	}

	var rawGUID *string
	if guid := strings.TrimSpace(item.GUID); guid != "" {
		rawGUID = &guid
	}

	var imageURL *string
	if value := feedextract.ImageFromFeedItem(item); value != "" {
		imageURL = &value
	}

	payload, _ := json.Marshal(item)
	hashInput := strings.Join([]string{
		strings.ToLower(title),
		strings.ToLower(summary),
		strings.ToLower(link),
		formatTime(publishedAt),
	}, "|")
	hashBytes := sha256.Sum256([]byte(hashInput))

	article := models.Article{
		SourceID:        sourceID,
		RawGUID:         rawGUID,
		Link:            link,
		CanonicalLink:   clustering.CanonicalizeLink(link),
		Title:           title,
		NormalizedTitle: clustering.NormalizeTitle(title),
		ContentHash:     hex.EncodeToString(hashBytes[:]),
		Raw:             datatypes.JSON(payload),
		Tags:            models.StringArray(normalizeTags(item.Categories)),
	}
	if summary != "" {
		article.Summary = &summary
	}
	if content != "" {
		article.Content = &content
	}
	if author != "" {
		article.Author = &author
	}
	if publishedAt != nil {
		article.PublishedAt = publishedAt
	}
	if imageURL != nil {
		article.ImageURL = imageURL
	}
	if replyCount := feedextract.ReplyCountFromFeedItem(item); replyCount != nil {
		article.ReplyCount = replyCount
	}

	return article, true
}

func formatTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return nil
	}

	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		value := strings.TrimSpace(tag)
		if value != "" {
			result = append(result, value)
		}
	}
	if len(result) == 0 {
		return nil
	}

	return result
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

func (w *RSSWorker) saveArticleIfNew(ctx context.Context, article models.Article) (bool, error) {
	tx := w.db.WithContext(ctx)

	if article.RawGUID != nil {
		var count int64
		if err := tx.Model(&models.Article{}).
			Where("source_id = ? AND raw_guid = ?", article.SourceID, *article.RawGUID).
			Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			if err := w.updateExistingArticleReplyCount(ctx, article); err != nil {
				return false, err
			}
			return false, nil
		}
	}

	{
		var count int64
		if err := tx.Model(&models.Article{}).
			Where("source_id = ? AND link = ?", article.SourceID, article.Link).
			Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			if err := w.updateExistingArticleReplyCount(ctx, article); err != nil {
				return false, err
			}
			return false, nil
		}
	}

	{
		var count int64
		if err := tx.Model(&models.Article{}).
			Where("source_id = ? AND content_hash = ?", article.SourceID, article.ContentHash).
			Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return false, nil
		}
	}

	if err := tx.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&article).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "duplicate key value violates unique constraint") {
				return gorm.ErrDuplicatedKey
			}
			return err
		}
		if err := clustering.AssignArticleToCluster(tx, &article); err != nil {
			return err
		}
		return nil
	}); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return false, nil
		}
		return false, err
	}

	return true, nil
}

func (w *RSSWorker) updateExistingArticleReplyCount(ctx context.Context, article models.Article) error {
	if article.ReplyCount == nil {
		return nil
	}
	return w.db.WithContext(ctx).
		Model(&models.Article{}).
		Where("source_id = ? AND link = ?", article.SourceID, article.Link).
		Where("reply_count IS NULL OR reply_count <> ?", *article.ReplyCount).
		Update("reply_count", *article.ReplyCount).Error
}

func (w *RSSWorker) markSourceSuccess(
	ctx context.Context,
	sourceID uint64,
	fetchedAt time.Time,
	etag *string,
	lastModified *string,
) error {
	updates := map[string]any{
		"last_fetched_at":      fetchedAt,
		"consecutive_failures": 0,
		"last_error_at":        nil,
		"last_error_message":   nil,
	}
	if etag != nil {
		updates["etag"] = *etag
	}
	if lastModified != nil {
		updates["last_modified"] = *lastModified
	}

	return w.db.WithContext(ctx).
		Model(&models.Source{}).
		Where("id = ?", sourceID).
		Updates(updates).Error
}

func (w *RSSWorker) markSourceFailure(
	ctx context.Context,
	sourceID uint64,
	fetchedAt time.Time,
	etag *string,
	lastModified *string,
	errorMessage string,
) error {
	updates := map[string]any{
		"last_fetched_at":      fetchedAt,
		"last_error_at":        fetchedAt,
		"last_error_message":   errorMessage,
		"consecutive_failures": gorm.Expr("consecutive_failures + 1"),
	}
	if etag != nil {
		updates["etag"] = *etag
	}
	if lastModified != nil {
		updates["last_modified"] = *lastModified
	}

	return w.db.WithContext(ctx).
		Model(&models.Source{}).
		Where("id = ?", sourceID).
		Updates(updates).Error
}
