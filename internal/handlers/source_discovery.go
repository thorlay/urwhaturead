package handlers

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"quick/internal/models"

	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
)

type discoverCandidate struct {
	RSSURL       string  `json:"rss_url"`
	Name         string  `json:"name"`
	FeedType     string  `json:"feed_type"`
	ItemCount    int     `json:"item_count"`
	HTTPStatus   int     `json:"http_status"`
	Confidence   string  `json:"confidence"`
	Reason       string  `json:"reason"`
	Existing     bool    `json:"existing"`
	SourceID     *uint64 `json:"source_id,omitempty"`
	SourceName   *string `json:"source_name,omitempty"`
	SuggestedTag string  `json:"suggested_tag"`
}

type discoverSeed struct {
	URL    string
	Reason string
	Score  int
}

type probeResult struct {
	HTTPStatus int
	FeedType   string
	Title      string
	ItemCount  int
	SampleText []string
}

type probeRSSItem struct {
	Title       string   `xml:"title"`
	Categories  []string `xml:"category"`
	Description string   `xml:"description"`
}

type probeAtomEntry struct {
	Title   string `xml:"title"`
	Summary string `xml:"summary"`
	Content string `xml:"content"`
}

const defaultRSSHubBaseURL = "http://127.0.0.1:1200"

func (h *SourceHandler) Discover(c *gin.Context) {
	var req discoverSourcesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	seedURL, err := normalizeDiscoverInputURL(req.URL)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	seeds := h.discoverFeedSeeds(c.Request.Context(), seedURL)
	if len(seeds) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"data": []discoverCandidate{},
			"meta": gin.H{
				"seed_url":     seedURL.String(),
				"count":        0,
				"probed_count": 0,
			},
		})
		return
	}

	const maxProbe = 12
	limit := maxProbe
	if len(seeds) < limit {
		limit = len(seeds)
	}

	discovered := make([]discoverCandidate, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, seed := range seeds[:limit] {
		probe, err := h.probeFeedWithContext(c.Request.Context(), seed.URL)
		if err != nil {
			continue
		}

		normalized := canonicalizeURL(seed.URL)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}

		discovered = append(discovered, discoverCandidate{
			RSSURL:       seed.URL,
			Name:         firstNonEmptyTrimmed(probe.Title, fallbackSourceNameFromURL(seed.URL)),
			FeedType:     probe.FeedType,
			ItemCount:    probe.ItemCount,
			HTTPStatus:   probe.HTTPStatus,
			Confidence:   confidenceFromScore(seed.Score),
			Reason:       seed.Reason,
			SuggestedTag: resolveSourceTag("", seed.URL, probe),
		})
	}

	if len(discovered) > 0 {
		byURL := make(map[string]int, len(discovered))
		urls := make([]string, 0, len(discovered))
		for idx, item := range discovered {
			normalized := canonicalizeURL(item.RSSURL)
			byURL[normalized] = idx
			urls = append(urls, item.RSSURL)
		}

		var existing []models.Source
		if err := h.db.WithContext(c.Request.Context()).Where("rss_url IN ?", urls).Find(&existing).Error; err == nil {
			for _, source := range existing {
				normalized := canonicalizeURL(source.RSSURL)
				idx, ok := byURL[normalized]
				if !ok {
					continue
				}
				discovered[idx].Existing = true
				discovered[idx].SourceID = &source.ID
				name := source.Name
				discovered[idx].SourceName = &name
			}
		}
	}

	sort.Slice(discovered, func(i, j int) bool {
		if discovered[i].Existing != discovered[j].Existing {
			return !discovered[i].Existing
		}
		if discovered[i].Confidence != discovered[j].Confidence {
			return confidenceRank(discovered[i].Confidence) > confidenceRank(discovered[j].Confidence)
		}
		return discovered[i].RSSURL < discovered[j].RSSURL
	})

	c.JSON(http.StatusOK, gin.H{
		"data": discovered,
		"meta": gin.H{
			"seed_url":     seedURL.String(),
			"count":        len(discovered),
			"probed_count": limit,
		},
	})
}

func (h *SourceHandler) probeFeed(feedURL string) (*probeResult, error) {
	return h.probeFeedWithContext(context.Background(), feedURL)
}

func (h *SourceHandler) probeFeedWithContext(ctx context.Context, feedURL string) (*probeResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "quick-news-aggregator/0.1")

	resp, err := h.clientForURL(feedURL).Do(req)
	logRedditHTTPResult("source.probeFeed", feedURL, resp, err)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	decoder := xml.NewDecoder(io.LimitReader(resp.Body, 2<<20))
	var feed struct {
		XMLName xml.Name `xml:""`
		Title   string   `xml:"title"`
		Channel struct {
			Title string         `xml:"title"`
			Items []probeRSSItem `xml:"item"`
		} `xml:"channel"`
		Entries []probeAtomEntry `xml:"entry"`
	}

	if err := decoder.Decode(&feed); err != nil {
		return nil, fmt.Errorf("parse xml: %w", err)
	}

	result := &probeResult{
		HTTPStatus: resp.StatusCode,
		FeedType:   "unknown",
	}

	switch feed.XMLName.Local {
	case "rss":
		result.FeedType = "rss"
		result.Title = feed.Channel.Title
		result.ItemCount = len(feed.Channel.Items)
		result.SampleText = sampleTextFromRSSItems(feed.Channel.Items)
	case "feed":
		result.FeedType = "atom"
		result.Title = feed.Title
		result.ItemCount = len(feed.Entries)
		result.SampleText = sampleTextFromAtomEntries(feed.Entries)
	default:
		if len(feed.Channel.Items) > 0 {
			result.FeedType = "rss"
			result.Title = feed.Channel.Title
			result.ItemCount = len(feed.Channel.Items)
			result.SampleText = sampleTextFromRSSItems(feed.Channel.Items)
		}
	}

	return result, nil
}

func (h *SourceHandler) discoverFeedSeeds(ctx context.Context, seedURL *url.URL) []discoverSeed {
	seedByURL := map[string]discoverSeed{}
	addSeed := func(rawURL string, reason string, score int) {
		normalized, ok := normalizeCandidateURL(seedURL, rawURL)
		if !ok {
			return
		}

		previous, exists := seedByURL[normalized]
		if !exists || score > previous.Score {
			seedByURL[normalized] = discoverSeed{
				URL:    normalized,
				Reason: reason,
				Score:  score,
			}
		}
	}

	seedURLString := seedURL.String()
	if isLikelyFeedURL(seedURLString) {
		addSeed(seedURLString, "输入地址本身是 RSS/Atom", 100)
	}

	root := &url.URL{
		Scheme: seedURL.Scheme,
		Host:   seedURL.Host,
		Path:   "/",
	}
	addCommonFeedPaths(addSeed, root)
	addHostSpecificFeedPaths(addSeed, root)

	htmlBody, finalURL, _, err := h.fetchBody(ctx, seedURLString, "text/html,application/xhtml+xml", 2<<20)
	if err == nil {
		for _, discovered := range extractFeedLinksFromHTML(finalURL, htmlBody) {
			addSeed(discovered, "页面 <link rel=alternate>", 95)
		}
		for _, discovered := range extractFeedLikeURLsFromText(string(htmlBody)) {
			addSeed(discovered, "页面中的 feed 链接", 70)
		}
	}

	sitemapQueue := make([]string, 0, 6)
	addSitemap := func(rawURL string) {
		candidate, ok := normalizeCandidateURL(root, rawURL)
		if !ok {
			return
		}
		sitemapQueue = append(sitemapQueue, candidate)
	}

	robotsURL := root.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
	if robotsBody, _, _, err := h.fetchBody(ctx, robotsURL, "text/plain,*/*", 512<<10); err == nil {
		for _, candidate := range extractFeedLikeURLsFromText(string(robotsBody)) {
			addSeed(candidate, "robots.txt 声明", 65)
		}
		for _, sitemapURL := range extractSitemapURLsFromRobots(string(robotsBody)) {
			addSitemap(sitemapURL)
		}
	}
	addSitemap(root.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String())

	visitedSitemap := map[string]struct{}{}
	for len(sitemapQueue) > 0 && len(visitedSitemap) < 4 {
		current := sitemapQueue[0]
		sitemapQueue = sitemapQueue[1:]
		if _, ok := visitedSitemap[current]; ok {
			continue
		}
		visitedSitemap[current] = struct{}{}

		body, _, _, err := h.fetchBody(ctx, current, "application/xml,text/xml,*/*", 2<<20)
		if err != nil {
			continue
		}
		locURLs, nestedSitemaps := extractSitemapLocURLs(body)
		for _, candidate := range locURLs {
			if !isLikelyFeedURL(candidate) {
				continue
			}
			addSeed(candidate, "sitemap 收录", 72)
		}
		for _, nested := range nestedSitemaps {
			addSitemap(nested)
		}
	}

	seeds := make([]discoverSeed, 0, len(seedByURL))
	for _, seed := range seedByURL {
		seeds = append(seeds, seed)
	}
	sort.Slice(seeds, func(i, j int) bool {
		if seeds[i].Score != seeds[j].Score {
			return seeds[i].Score > seeds[j].Score
		}
		return seeds[i].URL < seeds[j].URL
	})
	if len(seeds) > 24 {
		seeds = seeds[:24]
	}
	return seeds
}

func (h *SourceHandler) fetchBody(
	ctx context.Context,
	rawURL string,
	accept string,
	maxBytes int64,
) ([]byte, string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("User-Agent", "quick-news-aggregator/0.1")
	if strings.TrimSpace(accept) != "" {
		req.Header.Set("Accept", accept)
	}

	resp, err := h.clientForURL(rawURL).Do(req)
	logRedditHTTPResult("source.fetchBody", rawURL, resp, err)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, "", "", fmt.Errorf("status=%d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return nil, "", "", err
	}
	finalURL := rawURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	return body, finalURL, strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type"))), nil
}

func normalizeDiscoverInputURL(raw string) (*url.URL, error) {
	input := strings.TrimSpace(raw)
	if input == "" {
		return nil, fmt.Errorf("url is required")
	}
	if !strings.Contains(input, "://") {
		input = "https://" + input
	}

	parsed, err := url.Parse(input)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("url scheme must be http or https")
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return nil, fmt.Errorf("url host is required")
	}
	if strings.TrimSpace(parsed.Path) == "" {
		parsed.Path = "/"
	}
	parsed.Fragment = ""
	return parsed, nil
}

func normalizeCandidateURL(base *url.URL, raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}

	ref, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	if base != nil {
		ref = base.ResolveReference(ref)
	}
	if ref.Scheme != "http" && ref.Scheme != "https" {
		return "", false
	}
	if strings.TrimSpace(ref.Hostname()) == "" {
		return "", false
	}
	ref.Fragment = ""
	return canonicalizeURL(ref.String()), true
}

func canonicalizeURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	parsed.Fragment = ""
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	parsed.Scheme = strings.ToLower(strings.TrimSpace(parsed.Scheme))

	if parsed.Path != "/" {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	}
	return parsed.String()
}

func normalizeRSSHubBaseURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultRSSHubBaseURL
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return defaultRSSHubBaseURL
	}
	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "http" && scheme != "https" {
		return defaultRSSHubBaseURL
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return defaultRSSHubBaseURL
	}
	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	if parsed.Path != "/" {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	}
	return parsed.String()
}

func (h *SourceHandler) resolveSourceRSSURL(rawURL string) (string, error) {
	value := strings.TrimSpace(rawURL)
	if value == "" {
		return "", errors.New("rss_url cannot be empty")
	}
	expanded, err := expandRSSHubAliasURL(value, h.rsshubBaseURL)
	if err != nil {
		return "", err
	}
	return expanded, nil
}

func expandRSSHubAliasURL(rawURL string, baseURL string) (string, error) {
	value := strings.TrimSpace(rawURL)
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid rss_url: %w", err)
	}
	if strings.ToLower(strings.TrimSpace(parsed.Scheme)) != "rsshub" {
		return value, nil
	}

	base, err := url.Parse(normalizeRSSHubBaseURL(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid rsshub base url: %w", err)
	}

	routeParts := make([]string, 0, 8)
	if hostSegment := strings.TrimSpace(parsed.Hostname()); hostSegment != "" {
		routeParts = append(routeParts, hostSegment)
	}
	for _, part := range strings.Split(strings.Trim(parsed.Path, "/"), "/") {
		normalized := strings.TrimSpace(part)
		if normalized == "" {
			continue
		}
		routeParts = append(routeParts, normalized)
	}
	if len(routeParts) == 0 {
		return "", errors.New("rsshub url must include route path")
	}

	pathParts := make([]string, 0, len(routeParts)+1)
	if basePath := strings.Trim(base.Path, "/"); basePath != "" {
		pathParts = append(pathParts, strings.Split(basePath, "/")...)
	}
	pathParts = append(pathParts, routeParts...)
	base.Path = "/" + strings.Join(pathParts, "/")
	base.RawQuery = parsed.RawQuery
	base.Fragment = ""
	return base.String(), nil
}

func addCommonFeedPaths(add func(string, string, int), root *url.URL) {
	paths := []string{
		"/feed",
		"/feed.xml",
		"/rss",
		"/rss.xml",
		"/atom.xml",
		"/index.xml",
		"/?feed=rss",
	}
	for _, pathValue := range paths {
		ref, err := url.Parse(pathValue)
		if err != nil {
			continue
		}
		add(root.ResolveReference(ref).String(), "常见 feed 路径", 58)
	}
}

func addHostSpecificFeedPaths(add func(string, string, int), root *url.URL) {
	host := strings.ToLower(strings.TrimSpace(root.Hostname()))
	switch host {
	case "www.uscardforum.com", "uscardforum.com":
		add(root.ResolveReference(&url.URL{Path: "/top.rss"}).String(), "Discourse top", 88)
		add(root.ResolveReference(&url.URL{Path: "/latest.rss"}).String(), "Discourse latest", 82)
	case "news.ycombinator.com":
		add("https://hnrss.org/frontpage", "Hacker News RSS 镜像", 84)
		add("https://hnrss.org/best", "Hacker News RSS 镜像", 84)
	case "www.v2ex.com", "v2ex.com":
		add(root.ResolveReference(&url.URL{Path: "/index.xml"}).String(), "V2EX feed", 80)
	}
}

func extractFeedLinksFromHTML(baseURL string, body []byte) []string {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil
	}

	base, _ := url.Parse(baseURL)
	seen := map[string]struct{}{}
	feeds := make([]string, 0, 8)
	appendFeed := func(rawHref string) {
		normalized, ok := normalizeCandidateURL(base, rawHref)
		if !ok {
			return
		}
		if _, exists := seen[normalized]; exists {
			return
		}
		seen[normalized] = struct{}{}
		feeds = append(feeds, normalized)
	}

	doc.Find("link[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok || strings.TrimSpace(href) == "" {
			return
		}
		rel := strings.ToLower(strings.TrimSpace(attrOrEmpty(s, "rel")))
		typ := strings.ToLower(strings.TrimSpace(attrOrEmpty(s, "type")))
		if strings.Contains(rel, "alternate") &&
			(strings.Contains(typ, "rss") || strings.Contains(typ, "atom") || strings.Contains(typ, "xml") || isLikelyFeedURL(href)) {
			appendFeed(href)
		}
	})

	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok || !isLikelyFeedURL(href) {
			return
		}
		appendFeed(href)
	})

	return feeds
}

func extractFeedLikeURLsFromText(input string) []string {
	if strings.TrimSpace(input) == "" {
		return nil
	}
	splitter := func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == '"' || r == '\'' || r == '<' || r == '>'
	}
	parts := strings.FieldsFunc(input, splitter)
	seen := map[string]struct{}{}
	urls := make([]string, 0, 8)
	for _, token := range parts {
		if !(strings.HasPrefix(token, "http://") || strings.HasPrefix(token, "https://")) {
			continue
		}
		token = strings.TrimSpace(strings.TrimRight(token, ".,);"))
		if !isLikelyFeedURL(token) {
			continue
		}
		normalized := canonicalizeURL(token)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		urls = append(urls, normalized)
	}
	return urls
}

func extractSitemapURLsFromRobots(input string) []string {
	lines := strings.Split(input, "\n")
	result := make([]string, 0, 4)
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(text), "sitemap:") {
			continue
		}
		value := strings.TrimSpace(text[len("sitemap:"):])
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

func extractSitemapLocURLs(body []byte) (locURLs []string, sitemapURLs []string) {
	var parsed struct {
		URLs []struct {
			Loc string `xml:"loc"`
		} `xml:"url"`
		Sitemaps []struct {
			Loc string `xml:"loc"`
		} `xml:"sitemap"`
	}

	decoder := xml.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&parsed); err != nil {
		return nil, nil
	}
	for _, item := range parsed.URLs {
		value := strings.TrimSpace(item.Loc)
		if value != "" {
			locURLs = append(locURLs, value)
		}
	}
	for _, item := range parsed.Sitemaps {
		value := strings.TrimSpace(item.Loc)
		if value != "" {
			sitemapURLs = append(sitemapURLs, value)
		}
	}
	return locURLs, sitemapURLs
}

func isLikelyFeedURL(rawURL string) bool {
	value := strings.ToLower(strings.TrimSpace(rawURL))
	if value == "" {
		return false
	}
	return strings.Contains(value, "rss") ||
		strings.Contains(value, "atom") ||
		strings.Contains(value, "/feed") ||
		strings.Contains(value, ".xml")
}

func attrOrEmpty(selection *goquery.Selection, name string) string {
	value, ok := selection.Attr(name)
	if !ok {
		return ""
	}
	return value
}

func confidenceFromScore(score int) string {
	switch {
	case score >= 88:
		return "high"
	case score >= 70:
		return "medium"
	default:
		return "low"
	}
}

func confidenceRank(value string) int {
	switch value {
	case "high":
		return 3
	case "medium":
		return 2
	default:
		return 1
	}
}

func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func sampleTextFromRSSItems(items []probeRSSItem) []string {
	const maxItems = 8
	samples := make([]string, 0, maxItems)
	for i, item := range items {
		if i >= maxItems {
			break
		}
		text := firstNonEmptyTrimmed(item.Title, strings.Join(item.Categories, " "), item.Description)
		if text == "" {
			continue
		}
		samples = append(samples, compactFeedText(text))
	}
	return samples
}

func sampleTextFromAtomEntries(entries []probeAtomEntry) []string {
	const maxItems = 8
	samples := make([]string, 0, maxItems)
	for i, entry := range entries {
		if i >= maxItems {
			break
		}
		text := firstNonEmptyTrimmed(entry.Title, entry.Summary, entry.Content)
		if text == "" {
			continue
		}
		samples = append(samples, compactFeedText(text))
	}
	return samples
}

func compactFeedText(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	text = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ").Replace(text)
	text = strings.Join(strings.Fields(text), " ")
	return text
}
