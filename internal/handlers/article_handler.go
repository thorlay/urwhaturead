package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"quick/internal/aisummary"
	"quick/internal/articlesummary"
	"quick/internal/feedextract"
	"quick/internal/models"
	"quick/internal/textclean"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	maxSummaryCommentCount = 30
)

type ArticleHandler struct {
	db         *gorm.DB
	summarySvc *articlesummary.Service
	contentSvc *ArticleContentService
}

type ArticleHandlerOptions struct {
	ExternalFetchEnabled      bool
	ExternalFetchEnabledSet   bool
	ExternalFetchAllowedHosts []string
	ExternalFetchCacheTTL     time.Duration
	ExternalFetchFailureTTL   time.Duration
	ExternalFetchMaxBodyBytes int64
	ExternalFetchDailyReqMax  int
	ExternalFetchDailyByteMax int64
}

func NewArticleHandler(db *gorm.DB, summarizer *aisummary.Client) *ArticleHandler {
	return NewArticleHandlerWithOptions(db, summarizer, ArticleHandlerOptions{
		ExternalFetchEnabled:    true,
		ExternalFetchEnabledSet: true,
	})
}

func NewArticleHandlerWithOptions(db *gorm.DB, summarizer *aisummary.Client, options ArticleHandlerOptions) *ArticleHandler {
	handler := &ArticleHandler{
		db:         db,
		contentSvc: NewArticleContentService(options),
	}
	handler.summarySvc = articlesummary.NewService(db, summarizer, handler.loadSummaryInput)
	return handler
}

func (h *ArticleHandler) RegisterRoutes(group *gin.RouterGroup) {
	h.RegisterReadRoutes(group)
	h.RegisterWriteRoutes(group)
}

func (h *ArticleHandler) RegisterReadRoutes(group *gin.RouterGroup) {
	group.GET("/summaries", h.ListSummaries)
	group.GET("/:id", h.Get)
	group.GET("/:id/cluster-diagnosis", h.GetClusterDiagnosis)
	group.GET("/:id/summary", h.GetSummary)
	group.GET("/:id/summary/status", h.GetSummaryStatus)
}

func (h *ArticleHandler) RegisterWriteRoutes(group *gin.RouterGroup) {
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
	TopicURL     string                 `json:"topic_url"`
	FeedURL      string                 `json:"feed_url"`
	TopicTitle   string                 `json:"topic_title"`
	ExternalLink *string                `json:"external_link,omitempty"`
	FullContent  string                 `json:"full_content"`
	Comments     []articleThreadComment `json:"comments"`
	TotalPosts   int                    `json:"total_posts"`
	Truncated    bool                   `json:"truncated"`
}

type articleExternalContent struct {
	URL       string `json:"url"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

type articleDetail struct {
	ID           uint64                  `json:"id"`
	SourceID     uint64                  `json:"source_id"`
	SourceName   string                  `json:"source_name"`
	SourceTag    string                  `json:"source_tag"`
	SourceRSSURL string                  `json:"-" gorm:"column:source_rss_url"`
	RawGUID      *string                 `json:"raw_guid,omitempty"`
	Title        string                  `json:"title"`
	Link         string                  `json:"link"`
	Summary      *string                 `json:"summary,omitempty"`
	Content      *string                 `json:"content,omitempty"`
	ContentHTML  *string                 `json:"content_html,omitempty" gorm:"-"`
	Author       *string                 `json:"author,omitempty"`
	PublishedAt  *time.Time              `json:"published_at,omitempty"`
	ImageURL     *string                 `json:"image_url,omitempty"`
	ReplyCount   *int                    `json:"reply_count,omitempty"`
	Thread       *articleThread          `json:"thread,omitempty" gorm:"-"`
	External     *articleExternalContent `json:"external,omitempty" gorm:"-"`
	CreatedAt    time.Time               `json:"created_at"`
	Raw          datatypes.JSON          `json:"-" gorm:"column:raw"`
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

type articleSummaryTaskPayload struct {
	ArticleID uint64    `json:"article_id"`
	Model     string    `json:"model"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type articleSummaryListItem struct {
	ArticleID   uint64     `json:"article_id"`
	SourceID    uint64     `json:"source_id"`
	SourceName  string     `json:"source_name"`
	Title       string     `json:"title"`
	Link        string     `json:"link"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	Summary     string     `json:"summary"`
	Model       string     `json:"model"`
	Provider    string     `json:"provider"`
	InputChars  int        `json:"input_chars"`
	Truncated   bool       `json:"truncated"`
	GeneratedAt time.Time  `json:"generated_at"`
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
	if bumpErr := h.bumpSourceClick(c.Request.Context(), article.SourceID); bumpErr != nil {
		log.Printf("bump source click failed source_id=%d err=%v", article.SourceID, bumpErr)
	}

	c.JSON(http.StatusOK, article)
}

func (h *ArticleHandler) ListSummaries(c *gin.Context) {
	limit, offset, err := parseListWindow(c, 20, 100)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	query := h.db.WithContext(c.Request.Context()).
		Table("article_summaries AS sm").
		Select(`
			sm.article_id,
			a.source_id,
			s.name AS source_name,
			a.title,
			a.link,
			a.published_at,
			sm.summary,
			sm.model,
			sm.provider,
			sm.input_chars,
			sm.truncated,
			sm.generated_at
		`).
		Joins("JOIN articles AS a ON a.id = sm.article_id").
		Joins("JOIN sources AS s ON s.id = a.source_id")

	if keyword := strings.TrimSpace(c.Query("q")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(a.title ILIKE ? OR s.name ILIKE ? OR sm.summary ILIKE ?)", like, like, like)
	}

	var rows []articleSummaryListItem
	if err := query.
		Order("sm.generated_at DESC").
		Order("sm.article_id DESC").
		Limit(limit).
		Offset(offset).
		Scan(&rows).Error; err != nil {
		internalServerError(c, "query article summaries failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": rows,
		"meta": gin.H{
			"limit":  limit,
			"offset": offset,
			"count":  len(rows),
		},
	})
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
		updates := map[string]any{}
		if strings.TrimSpace(existing.Kind) != "thread" {
			updates["kind"] = "thread"
		}
		if existing.HiddenInSidebar {
			updates["hidden_in_sidebar"] = false
		}
		if existing.TopicURL == nil || strings.TrimSpace(*existing.TopicURL) == "" {
			updates["topic_url"] = target.TopicURL
		}
		if len(existing.Tags) == 0 {
			updates["tags"] = mergeSourceTags(existing.Tags)
		}
		if len(updates) > 0 {
			if err := h.db.WithContext(c.Request.Context()).
				Model(&models.Source{}).
				Where("id = ?", existing.ID).
				Updates(updates).Error; err == nil {
				_ = h.db.WithContext(c.Request.Context()).First(&existing, existing.ID).Error
			}
		}
		normalizeSourceForResponse(&existing)
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
		Kind:            "thread",
		TopicURL:        &target.TopicURL,
		HiddenInSidebar: false,
		Tags:            mergeSourceTags([]string{"forum-thread"}),
		Enabled:         true,
		PollIntervalSec: 120,
	}
	if err := h.db.WithContext(c.Request.Context()).Create(&source).Error; err != nil {
		internalServerError(c, "create tracking source failed", err)
		return
	}

	normalizeSourceForResponse(&source)
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
	if h.summarySvc == nil || !h.summarySvc.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "ai summary is not configured",
		})
		return
	}
	refresh := parseBoolQuery(c.Query("refresh"))
	asyncRequested := parseBoolQuery(c.Query("async"))
	requestedModel := strings.TrimSpace(c.Query("model"))
	log.Printf(
		"summary request started article_id=%d refresh=%t async=%t model=%s",
		id,
		refresh,
		asyncRequested,
		firstNonEmpty(requestedModel, "<default>"),
	)

	if !refresh {
		cacheLookupStartedAt := time.Now()
		payload, found, err := h.getCachedSummaryPayload(c.Request.Context(), id, requestedModel)
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

	if asyncRequested {
		taskPayload := h.enqueueSummaryTask(id, requestedModel, refresh)
		c.JSON(http.StatusAccepted, gin.H{
			"data": taskPayload,
		})
		return
	}

	payload, stage, err := h.generateAndSaveSummary(c.Request.Context(), id, requestedModel)
	if err != nil {
		switch stage {
		case "load":
			h.handleLoadArticleError(c, err)
		case "empty":
			badRequest(c, "article content is empty")
		case "ai":
			badGateway(c, err.Error())
		case "save":
			internalServerError(c, "save summary cache failed", err)
		default:
			internalServerError(c, "generate summary failed", err)
		}
		return
	}
	totalMs := time.Since(requestStartedAt).Milliseconds()
	log.Printf(
		"summary generated article_id=%d input_chars=%d truncated=%t total_ms=%d",
		id,
		payload.InputChars,
		payload.Truncated,
		totalMs,
	)

	c.JSON(http.StatusOK, gin.H{
		"data": payload,
	})
}

func (h *ArticleHandler) GetSummary(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	requestedModel := strings.TrimSpace(c.Query("model"))

	payload, found, err := h.getCachedSummaryPayload(c.Request.Context(), id, requestedModel)
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

func (h *ArticleHandler) GetSummaryStatus(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	requestedModel := strings.TrimSpace(c.Query("model"))

	if payload, found, err := h.getCachedSummaryPayload(c.Request.Context(), id, requestedModel); err == nil && found {
		c.JSON(http.StatusOK, gin.H{
			"data": articleSummaryTaskPayload{
				ArticleID: payload.ArticleID,
				Model:     payload.Model,
				Status:    articlesummary.StatusSucceeded,
				UpdatedAt: payload.GeneratedAt,
			},
		})
		return
	} else if err != nil {
		internalServerError(c, "query summary cache failed", err)
		return
	}

	state := h.getSummaryTaskState(id, requestedModel)
	c.JSON(http.StatusOK, gin.H{
		"data": articleSummaryTaskPayload{
			ArticleID: id,
			Model:     requestedModel,
			Status:    state.Status,
			Error:     state.Error,
			UpdatedAt: state.UpdatedAt,
		},
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
			COALESCE(NULLIF(s.tags[1], ''), 'general') AS source_tag,
			s.rss_url AS source_rss_url,
			a.raw_guid,
			a.title,
			a.link,
			a.summary,
			a.content,
			a.raw,
			a.author,
			a.published_at,
			a.image_url,
			a.reply_count,
			a.created_at
		`).
		Joins("JOIN sources AS s ON s.id = a.source_id").
		Where("a.id = ?", id).
		Take(&article).Error
	if err != nil {
		return articleDetail{}, err
	}

	if contentHTML := feedextract.ContentHTMLFromRaw(article.Raw); contentHTML != "" {
		article.ContentHTML = &contentHTML
	}
	if article.ImageURL == nil {
		if fallback := feedextract.ImageFromRaw(article.Raw, article.Link); fallback != "" {
			article.ImageURL = &fallback
		}
	}

	if thread, ok := h.contentSvc.fetchThreadForTopic(ctx, article.Link); ok {
		article.Thread = thread
	}
	if article.Thread != nil && article.Thread.ExternalLink != nil {
		if external, ok := h.contentSvc.fetchExternalArticle(ctx, *article.Thread.ExternalLink); ok {
			article.External = external
		}
	}
	if article.External == nil && shouldFetchExternalArticle(article.SourceName, article.SourceRSSURL, article.Link) {
		if external, ok := h.contentSvc.fetchExternalArticle(ctx, article.Link); ok {
			article.External = external
		}
	}
	sanitizeArticleForOutput(&article)

	return article, nil
}

func (h *ArticleHandler) loadSummaryInput(ctx context.Context, id uint64) (articlesummary.ArticleInput, error) {
	article, err := h.loadArticleDetail(ctx, id)
	if err != nil {
		return articlesummary.ArticleInput{}, err
	}
	return articlesummary.ArticleInput{
		ID:         article.ID,
		Title:      article.Title,
		SourceText: buildSummarySourceText(article),
	}, nil
}

func (h *ArticleHandler) handleLoadArticleError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		notFound(c, "article not found")
		return
	}
	internalServerError(c, "query article failed", err)
}

func (h *ArticleHandler) bumpSourceClick(ctx context.Context, sourceID uint64) error {
	if sourceID == 0 {
		return nil
	}
	return h.db.WithContext(ctx).
		Model(&models.Source{}).
		Where("id = ?", sourceID).
		Updates(map[string]any{
			"click_count":     gorm.Expr("click_count + 1"),
			"last_clicked_at": time.Now().UTC(),
		}).Error
}

func buildSummarySourceText(article articleDetail) string {
	parts := make([]string, 0, 6)
	if article.Summary != nil && strings.TrimSpace(*article.Summary) != "" {
		parts = append(parts, textclean.NormalizeFromHTML(*article.Summary))
	}
	if article.Content != nil && strings.TrimSpace(*article.Content) != "" {
		parts = append(parts, textclean.NormalizeFromHTML(*article.Content))
	}
	if article.External != nil && strings.TrimSpace(article.External.Content) != "" {
		parts = append(parts, textclean.NormalizeFromHTML(article.External.Content))
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

func sanitizeArticleForOutput(article *articleDetail) {
	if article == nil {
		return
	}
	article.Title = textclean.NormalizeInline(article.Title)
	if article.Summary != nil {
		value := textclean.NormalizeFromHTML(*article.Summary)
		if value == "" {
			article.Summary = nil
		} else {
			article.Summary = &value
		}
	}
	if article.Content != nil {
		value := textclean.NormalizeFromHTMLBlock(*article.Content)
		if value == "" {
			article.Content = nil
		} else {
			article.Content = &value
		}
	}
	if article.ContentHTML != nil {
		value := strings.TrimSpace(*article.ContentHTML)
		if value == "" {
			article.ContentHTML = nil
		} else {
			article.ContentHTML = &value
		}
	}
	if article.Author != nil {
		value := textclean.NormalizeInline(*article.Author)
		if value == "" {
			article.Author = nil
		} else {
			article.Author = &value
		}
	}
	if article.External != nil {
		article.External.Title = textclean.NormalizeInline(article.External.Title)
		article.External.Content = textclean.NormalizeFromHTMLBlock(article.External.Content)
	}
	if article.Thread != nil {
		article.Thread.TopicTitle = textclean.NormalizeInline(article.Thread.TopicTitle)
		article.Thread.FullContent = textclean.NormalizeFromHTMLBlock(article.Thread.FullContent)
		for i := range article.Thread.Comments {
			comment := &article.Thread.Comments[i]
			comment.Author = textclean.NormalizeInline(comment.Author)
			comment.Content = textclean.NormalizeFromHTMLBlock(comment.Content)
		}
	}
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

func (h *ArticleHandler) enqueueSummaryTask(articleID uint64, requestedModel string, refresh bool) articleSummaryTaskPayload {
	if h.summarySvc == nil {
		return articleSummaryTaskPayload{
			ArticleID: articleID,
			Model:     strings.TrimSpace(requestedModel),
			Status:    articlesummary.StatusFailed,
			Error:     "summary service is not configured",
			UpdatedAt: time.Now().UTC(),
		}
	}
	return toArticleSummaryTaskPayload(h.summarySvc.EnqueueTask(articleID, requestedModel, refresh))
}

func (h *ArticleHandler) generateAndSaveSummary(
	ctx context.Context,
	articleID uint64,
	requestedModel string,
) (articleSummaryPayload, string, error) {
	if h.summarySvc == nil {
		return articleSummaryPayload{}, "ai", errors.New("summary service is not configured")
	}
	payload, stage, err := h.summarySvc.GenerateAndSave(ctx, articleID, requestedModel)
	if err != nil {
		return articleSummaryPayload{}, stage, err
	}
	return toArticleSummaryPayload(payload), "", nil
}

func (h *ArticleHandler) getSummaryTaskState(articleID uint64, requestedModel string) articlesummary.TaskState {
	if h.summarySvc == nil {
		return articlesummary.TaskState{
			Status:    articlesummary.StatusFailed,
			Error:     "summary service is not configured",
			UpdatedAt: time.Now().UTC(),
		}
	}
	return h.summarySvc.GetTaskState(articleID, requestedModel)
}

func (h *ArticleHandler) getCachedSummaryPayload(ctx context.Context, articleID uint64, requestedModel string) (articleSummaryPayload, bool, error) {
	if h.summarySvc == nil {
		return articleSummaryPayload{}, false, errors.New("summary service is not configured")
	}
	payload, found, err := h.summarySvc.GetCachedPayload(ctx, articleID, requestedModel)
	if err != nil || !found {
		return articleSummaryPayload{}, found, err
	}
	return toArticleSummaryPayload(payload), true, nil
}

func toArticleSummaryPayload(payload articlesummary.SummaryPayload) articleSummaryPayload {
	return articleSummaryPayload{
		ArticleID:   payload.ArticleID,
		Summary:     payload.Summary,
		Model:       payload.Model,
		InputChars:  payload.InputChars,
		Truncated:   payload.Truncated,
		Provider:    payload.Provider,
		GeneratedAt: payload.GeneratedAt,
		CacheHit:    payload.CacheHit,
	}
}

func toArticleSummaryTaskPayload(payload articlesummary.TaskPayload) articleSummaryTaskPayload {
	return articleSummaryTaskPayload{
		ArticleID: payload.ArticleID,
		Model:     payload.Model,
		Status:    payload.Status,
		Error:     payload.Error,
		UpdatedAt: payload.UpdatedAt,
	}
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
	return normalizeSiteKey(rawURL)
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
