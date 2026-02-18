package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"quick/internal/models"

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
}

type RSSWorker struct {
	db               *gorm.DB
	tick             time.Duration
	httpClient       *http.Client
	parser           *gofeed.Parser
	inflight         sync.Map
	requestRetries   int
	retryBaseDelay   time.Duration
	backoffMaxFactor int
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

	return &RSSWorker{
		db:               db,
		tick:             time.Duration(options.TickSec) * time.Second,
		requestRetries:   options.RequestRetries,
		retryBaseDelay:   time.Duration(options.RetryBaseSec) * time.Second,
		backoffMaxFactor: options.BackoffMaxFactor,
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
		parser: gofeed.NewParser(),
	}
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

	feed, err := w.parser.Parse(bytes.NewReader(result.Body))
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
	attempts := w.requestRetries + 1
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
	req.Header.Set("User-Agent", "quick-rss-worker/0.1")

	if source.ETag != nil && strings.TrimSpace(*source.ETag) != "" {
		req.Header.Set("If-None-Match", *source.ETag)
	}
	if source.LastModified != nil && strings.TrimSpace(*source.LastModified) != "" {
		req.Header.Set("If-Modified-Since", *source.LastModified)
	}

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return nil, fetchError{
			Message:   fmt.Sprintf("request failed: %v", err),
			Retryable: true,
		}
	}
	defer resp.Body.Close()

	etag := cleanHeader(resp.Header.Get("ETag"))
	lastModified := cleanHeader(resp.Header.Get("Last-Modified"))

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

	return &fetchResult{
		HTTPStatus:   resp.StatusCode,
		ETag:         etag,
		LastModified: lastModified,
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

func mapFeedItemToArticle(sourceID uint64, item *gofeed.Item) (models.Article, bool) {
	link := strings.TrimSpace(item.Link)
	if link == "" {
		return models.Article{}, false
	}

	title := strings.TrimSpace(item.Title)
	if title == "" {
		title = link
	}

	summary := firstNonEmpty(item.Description, item.Content)
	content := strings.TrimSpace(item.Content)
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

	var rawGUID *string
	if guid := strings.TrimSpace(item.GUID); guid != "" {
		rawGUID = &guid
	}

	var imageURL *string
	if item.Image != nil {
		if value := strings.TrimSpace(item.Image.URL); value != "" {
			imageURL = &value
		}
	}
	if imageURL == nil {
		for _, enclosure := range item.Enclosures {
			if strings.HasPrefix(strings.ToLower(enclosure.Type), "image/") {
				if value := strings.TrimSpace(enclosure.URL); value != "" {
					imageURL = &value
					break
				}
			}
		}
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
		SourceID:    sourceID,
		RawGUID:     rawGUID,
		Link:        link,
		Title:       title,
		ContentHash: hex.EncodeToString(hashBytes[:]),
		Raw:         datatypes.JSON(payload),
		Tags:        models.StringArray(normalizeTags(item.Categories)),
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

	if err := tx.Create(&article).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate key value violates unique constraint") {
			return false, nil
		}
		return false, err
	}

	return true, nil
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
