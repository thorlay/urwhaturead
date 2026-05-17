package sourceclassify

import (
	"net"
	"net/url"
	"strings"
)

const DefaultTag = "general"

const recentArticleSnippetLimit = 280

type FeedProbe struct {
	Title      string
	SampleText []string
}

type ArticleTextInput struct {
	Title   string
	Summary string
	Content string
	Tags    []string
}

var tagKeywordRules = []struct {
	Tag      string
	Keywords []string
}{
	{Tag: "jobs", Keywords: []string{"hiring", "jobs", "job ", "career", "who is hiring", "招聘", "求职", "内推", "远程工作"}},
	{Tag: "finance", Keywords: []string{"finance", "market", "stocks", "invest", "economy", "fed", "interest rate", "credit card", "rewards", "points", "财经", "金融", "股票", "市场", "美股", "港股", "a股", "基金", "投资", "银行", "利率", "美联储", "财报", "债券", "加密货币", "信用卡", "返现", "积分"}},
	{Tag: "tech", Keywords: []string{"tech", "software", "developer", "programming", "open source", "hacker news", "artificial intelligence", "llm", "gpt", "startup", "github", "v2ex", "科技", "技术", "软件", "编程", "开发", "开源", "人工智能", "大模型", "模型", "芯片", "程序员", "互联网"}},
	{Tag: "world", Keywords: []string{"world", "international", "geopolitic", "global", "election", "war", "国际", "全球", "地缘", "选举", "战争", "外交", "政治"}},
	{Tag: "science", Keywords: []string{"science", "research", "space", "physics", "biology", "medicine", "科学", "研究", "太空", "物理", "生物", "医学", "航天"}},
	{Tag: "sports", Keywords: []string{"sports", "nfl", "nba", "soccer", "mlb", "tennis", "体育", "足球", "篮球", "网球"}},
	{Tag: "forum", Keywords: []string{"forum", "thread", "discussion", "community", "reddit", "comment", "论坛", "帖子", "回复", "评论", "楼主", "请教", "讨论", "分享"}},
}

func NormalizeTag(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func NormalizeTags(rawTags []string) []string {
	if len(rawTags) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(rawTags))
	out := make([]string, 0, len(rawTags))
	for _, raw := range rawTags {
		tag := NormalizeTag(raw)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}

func MergeTags(rawTags []string) []string {
	tags := NormalizeTags(rawTags)
	if len(tags) == 0 {
		tags = append(tags, DefaultTag)
	}
	return tags
}

func ShouldAutoInferTag(tag string) bool {
	value := strings.ToLower(strings.TrimSpace(tag))
	return value == "" || value == DefaultTag || value == "auto"
}

func ShouldInferFromProvidedTags(tags []string) bool {
	if len(tags) == 0 {
		return true
	}
	return len(tags) == 1 && ShouldAutoInferTag(tags[0])
}

func ResolveTag(requestedTag string, rssURL string, probe *FeedProbe) string {
	tag, _ := ResolveTagWithReason(requestedTag, rssURL, probe)
	return tag
}

func ResolveTagWithReason(requestedTag string, rssURL string, probe *FeedProbe) (string, string) {
	return ResolveTagWithRecentText(requestedTag, rssURL, probe, nil)
}

func ResolveTagWithRecentText(requestedTag string, rssURL string, probe *FeedProbe, recentText []string) (string, string) {
	if !ShouldAutoInferTag(requestedTag) {
		return strings.TrimSpace(requestedTag), "explicit"
	}
	if tag, ok := inferTagByRule(rssURL); ok {
		return tag, "rule"
	}
	if tag := InferTagByRecentText(recentText); tag != "" {
		return tag, "recent_articles"
	}
	if tag := inferTagByKeywords(rssURL, probe); tag != "" {
		return tag, "keywords"
	}
	return DefaultTag, "fallback"
}

func InferTagByRecentText(recentText []string) string {
	if len(recentText) == 0 {
		return ""
	}
	return inferTagFromCorpus(recentText, 2)
}

func CompactArticleText(article ArticleTextInput) string {
	parts := make([]string, 0, 4)
	if title := compactSnippet(article.Title); title != "" {
		parts = append(parts, title)
	}
	if summary := compactSnippet(article.Summary); summary != "" {
		parts = append(parts, summary)
	}
	if content := compactSnippet(article.Content); content != "" {
		parts = append(parts, content)
	}
	if len(article.Tags) > 0 {
		if tags := compactSnippet(strings.Join(article.Tags, " ")); tags != "" {
			parts = append(parts, tags)
		}
	}
	return strings.Join(parts, " ")
}

func EqualTags(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if NormalizeTag(left[i]) != NormalizeTag(right[i]) {
			return false
		}
	}
	return true
}

func ApplyTagBulkAction(current []string, tags []string, action string) []string {
	base := MergeTags(current)
	target := NormalizeTags(tags)
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "replace":
		return MergeTags(target)
	case "remove":
		return removeTags(base, target)
	default:
		return MergeTags(append(base, target...))
	}
}

func inferTagByRule(rssURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rssURL))
	if err != nil {
		return "", false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	path := strings.ToLower(strings.TrimSpace(parsed.Path))

	switch {
	case host == "hnrss.org" || host == "news.ycombinator.com":
		return "tech", true
	case host == "www.uscardforum.com" || host == "uscardforum.com":
		return "forum", true
	case host == "www.reddit.com" || host == "reddit.com" || host == "old.reddit.com" || host == "redd.it":
		return "forum", true
	case host == "www.v2ex.com" || host == "v2ex.com":
		return "tech", true
	case strings.Contains(host, "bloomberg.com"):
		return "finance", true
	case strings.Contains(host, "espn.com"):
		return "sports", true
	case strings.Contains(host, "nature.com") || strings.Contains(host, "science.org"):
		return "science", true
	case isRSSHubProviderURL(parsed):
		segment := firstPathSegment(path)
		switch segment {
		case "v2ex", "hackernews", "github":
			return "tech", true
		case "reddit", "1point3acres", "uscardforum", "nga", "tieba":
			return "forum", true
		case "bloomberg":
			return "finance", true
		}
	}
	return "", false
}

func inferTagByKeywords(rssURL string, probe *FeedProbe) string {
	parts := []string{strings.ToLower(strings.TrimSpace(rssURL))}
	if probe != nil {
		if title := strings.ToLower(strings.TrimSpace(probe.Title)); title != "" {
			parts = append(parts, title)
		}
		for _, sample := range probe.SampleText {
			if text := strings.ToLower(strings.TrimSpace(sample)); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return inferTagFromCorpus(parts, 2)
}

func inferTagFromCorpus(parts []string, minScore int) string {
	corpus := strings.ToLower(strings.Join(parts, " "))
	if corpus == "" {
		return ""
	}

	bestTag := ""
	bestScore := 0
	for _, rule := range tagKeywordRules {
		score := 0
		for _, keyword := range rule.Keywords {
			score += keywordMatchScore(corpus, keyword)
		}
		if score > bestScore {
			bestScore = score
			bestTag = rule.Tag
		}
	}
	if bestScore < minScore {
		return ""
	}
	return bestTag
}

func keywordMatchScore(corpus string, keyword string) int {
	normalized := strings.ToLower(strings.TrimSpace(keyword))
	if normalized == "" {
		return 0
	}
	if isShortASCIIKeyword(normalized) {
		return shortASCIIKeywordMatchScore(corpus, normalized)
	}
	return strings.Count(corpus, normalized)
}

func isShortASCIIKeyword(value string) bool {
	if len(value) > 3 {
		return false
	}
	for _, r := range value {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func shortASCIIKeywordMatchScore(corpus string, keyword string) int {
	fields := strings.FieldsFunc(corpus, func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
	score := 0
	for _, field := range fields {
		if field == keyword {
			score++
		}
	}
	return score
}

func compactSnippet(value string) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if normalized == "" {
		return ""
	}
	runes := []rune(normalized)
	if len(runes) <= recentArticleSnippetLimit {
		return normalized
	}
	return string(runes[:recentArticleSnippetLimit])
}

func removeTags(current []string, toRemove []string) []string {
	if len(current) == 0 {
		return MergeTags(nil)
	}
	removeSet := make(map[string]struct{}, len(toRemove))
	for _, tag := range toRemove {
		value := NormalizeTag(tag)
		if value == "" {
			continue
		}
		removeSet[value] = struct{}{}
	}
	if len(removeSet) == 0 {
		return MergeTags(current)
	}

	next := make([]string, 0, len(current))
	for _, tag := range current {
		value := NormalizeTag(tag)
		if value == "" {
			continue
		}
		if _, exists := removeSet[value]; exists {
			continue
		}
		next = append(next, value)
	}
	return MergeTags(next)
}

func isRSSHubProviderURL(u *url.URL) bool {
	if u == nil {
		return false
	}
	host := strings.TrimSpace(strings.ToLower(u.Hostname()))
	if host == "" {
		return false
	}
	if isRSSHubHost(host) {
		return true
	}
	if !isLocalOrPrivateHost(host) {
		return false
	}
	return looksLikeRSSHubPath(u.Path)
}

func isRSSHubHost(host string) bool {
	switch strings.TrimSpace(strings.ToLower(host)) {
	case "rsshub.rssforever.com", "rsshub.app", "www.rsshub.app":
		return true
	default:
		return false
	}
}

func looksLikeRSSHubPath(pathValue string) bool {
	trimmed := strings.Trim(pathValue, "/")
	if trimmed == "" {
		return false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		return false
	}
	first := strings.TrimSpace(strings.ToLower(parts[0]))
	return first != "" && !strings.Contains(first, ".")
}

func firstPathSegment(pathValue string) string {
	trimmed := strings.Trim(pathValue, "/")
	if trimmed == "" {
		return ""
	}
	parts := strings.Split(trimmed, "/")
	for _, part := range parts {
		normalized := strings.TrimSpace(strings.ToLower(part))
		if normalized != "" {
			return normalized
		}
	}
	return ""
}

func isLocalOrPrivateHost(host string) bool {
	normalized := strings.TrimSpace(strings.ToLower(host))
	if normalized == "localhost" {
		return true
	}
	ip := net.ParseIP(normalized)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
