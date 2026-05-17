package handlers

import (
	"net/url"
	"strings"

	"quick/internal/models"
)

const defaultSourceTag = "general"

var sourceTagKeywordRules = []struct {
	Tag      string
	Keywords []string
}{
	{
		Tag:      "jobs",
		Keywords: []string{"hiring", "jobs", "job ", "career", "who is hiring", "招聘", "求职", "内推", "远程工作"},
	},
	{
		Tag:      "finance",
		Keywords: []string{"finance", "market", "stocks", "invest", "economy", "fed", "interest rate", "credit card", "rewards", "points", "财经", "金融", "股票", "市场", "美股", "港股", "a股", "基金", "投资", "银行", "利率", "美联储", "财报", "债券", "加密货币", "信用卡", "返现", "积分"},
	},
	{
		Tag:      "tech",
		Keywords: []string{"tech", "software", "developer", "programming", "open source", "hacker news", "artificial intelligence", "llm", "gpt", "startup", "github", "v2ex", "科技", "技术", "软件", "编程", "开发", "开源", "人工智能", "大模型", "模型", "芯片", "程序员", "互联网"},
	},
	{
		Tag:      "world",
		Keywords: []string{"world", "international", "geopolitic", "global", "election", "war", "国际", "全球", "地缘", "选举", "战争", "外交", "政治"},
	},
	{
		Tag:      "science",
		Keywords: []string{"science", "research", "space", "physics", "biology", "medicine", "科学", "研究", "太空", "物理", "生物", "医学", "航天"},
	},
	{
		Tag:      "sports",
		Keywords: []string{"sports", "nfl", "nba", "soccer", "mlb", "tennis", "体育", "足球", "篮球", "网球"},
	},
	{
		Tag:      "forum",
		Keywords: []string{"forum", "thread", "discussion", "community", "reddit", "comment", "论坛", "帖子", "回复", "评论", "楼主", "请教", "讨论", "分享"},
	},
}

func normalizeSourceForResponse(source *models.Source) {
	if source == nil {
		return
	}
	source.Name = normalizeDisplaySourceName(source.Name, source.RSSURL)
	source.SiteKey = normalizeSiteKey(source.RSSURL)
	source.Tags = mergeSourceTags(source.Tags)
}

func mergeSourceTags(rawTags []string) models.StringArray {
	tags := normalizeSourceTags(rawTags)
	if len(tags) == 0 {
		tags = append(tags, defaultSourceTag)
	}
	return tags
}

func normalizeSourceTags(rawTags []string) models.StringArray {
	if len(rawTags) == 0 {
		return models.StringArray{}
	}
	seen := make(map[string]struct{}, len(rawTags))
	out := make(models.StringArray, 0, len(rawTags))
	for _, raw := range rawTags {
		tag := normalizeSourceTag(raw)
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

func normalizeSourceTag(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func normalizeSourceKindValue(raw string) string {
	kind := strings.ToLower(strings.TrimSpace(raw))
	switch kind {
	case "thread":
		return "thread"
	case "feed":
		return "feed"
	default:
		return "feed"
	}
}

func containsSourceTag(tags []string, candidate string) bool {
	for _, tag := range tags {
		if normalizeSourceTag(tag) == candidate {
			return true
		}
	}
	return false
}

func shouldAutoInferTag(tag string) bool {
	value := strings.ToLower(strings.TrimSpace(tag))
	return value == "" || value == defaultSourceTag || value == "auto"
}

func shouldInferFromProvidedTags(tags []string) bool {
	if len(tags) == 0 {
		return true
	}
	return len(tags) == 1 && shouldAutoInferTag(tags[0])
}

func resolveSourceTag(requestedTag string, rssURL string, probe *probeResult) string {
	tag, _ := resolveSourceTagWithReason(requestedTag, rssURL, probe)
	return tag
}

func resolveSourceTagWithReason(requestedTag string, rssURL string, probe *probeResult) (string, string) {
	return resolveSourceTagWithRecentText(requestedTag, rssURL, probe, nil)
}

func resolveSourceTagWithRecentText(requestedTag string, rssURL string, probe *probeResult, recentText []string) (string, string) {
	if !shouldAutoInferTag(requestedTag) {
		return strings.TrimSpace(requestedTag), "explicit"
	}

	if tag, ok := inferSourceTagByRule(rssURL); ok {
		return tag, "rule"
	}

	if tag := inferSourceTagByRecentText(recentText); tag != "" {
		return tag, "recent_articles"
	}

	if tag := inferSourceTagByKeywords(rssURL, probe); tag != "" {
		return tag, "keywords"
	}

	return defaultSourceTag, "fallback"
}

func inferSourceTagByRule(rssURL string) (string, bool) {
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

func inferSourceTagByRecentText(recentText []string) string {
	if len(recentText) == 0 {
		return ""
	}
	return inferSourceTagFromCorpus(recentText, 2)
}

func inferSourceTagByKeywords(rssURL string, probe *probeResult) string {
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
	return inferSourceTagFromCorpus(parts, 2)
}

func inferSourceTagFromCorpus(parts []string, minScore int) string {
	corpus := strings.ToLower(strings.Join(parts, " "))
	if corpus == "" {
		return ""
	}

	bestTag := ""
	bestScore := 0
	for _, rule := range sourceTagKeywordRules {
		score := 0
		for _, keyword := range rule.Keywords {
			score += keywordMatchScore(corpus, keyword)
		}
		if score > bestScore {
			bestScore = score
			bestTag = rule.Tag
		}
	}

	if bestScore < 2 {
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

func equalStringArrays(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if normalizeSourceTag(left[i]) != normalizeSourceTag(right[i]) {
			return false
		}
	}
	return true
}

func applySourceTagBulkAction(current []string, tags []string, action string) models.StringArray {
	base := mergeSourceTags(current)
	target := normalizeSourceTags(tags)
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "replace":
		return mergeSourceTags(target)
	case "remove":
		return removeSourceTags(base, target)
	default:
		return mergeSourceTags(append(base, target...))
	}
}

func removeSourceTags(current []string, toRemove []string) models.StringArray {
	if len(current) == 0 {
		return mergeSourceTags(nil)
	}
	removeSet := make(map[string]struct{}, len(toRemove))
	for _, tag := range toRemove {
		value := normalizeSourceTag(tag)
		if value == "" {
			continue
		}
		removeSet[value] = struct{}{}
	}
	if len(removeSet) == 0 {
		return mergeSourceTags(current)
	}

	next := make([]string, 0, len(current))
	for _, tag := range current {
		value := normalizeSourceTag(tag)
		if value == "" {
			continue
		}
		if _, exists := removeSet[value]; exists {
			continue
		}
		next = append(next, value)
	}
	return mergeSourceTags(next)
}
