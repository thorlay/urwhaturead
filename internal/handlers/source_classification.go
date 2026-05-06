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
		Keywords: []string{"hiring", "jobs", "job ", "career", "who is hiring"},
	},
	{
		Tag:      "finance",
		Keywords: []string{"finance", "market", "stocks", "invest", "economy", "fed", "interest rate", "credit card", "rewards", "points"},
	},
	{
		Tag:      "tech",
		Keywords: []string{"tech", "software", "developer", "programming", "open source", "hacker news", "ai", "startup", "github", "v2ex"},
	},
	{
		Tag:      "world",
		Keywords: []string{"world", "international", "geopolitic", "global", "election", "war"},
	},
	{
		Tag:      "science",
		Keywords: []string{"science", "research", "space", "physics", "biology", "medicine"},
	},
	{
		Tag:      "sports",
		Keywords: []string{"sports", "nfl", "nba", "soccer", "mlb", "tennis"},
	},
	{
		Tag:      "forum",
		Keywords: []string{"forum", "thread", "discussion", "community", "reddit", "comment"},
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
	if !shouldAutoInferTag(requestedTag) {
		return strings.TrimSpace(requestedTag), "explicit"
	}

	if tag, ok := inferSourceTagByRule(rssURL); ok {
		return tag, "rule"
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
	corpus := strings.Join(parts, " ")
	if corpus == "" {
		return ""
	}

	bestTag := ""
	bestScore := 0
	for _, rule := range sourceTagKeywordRules {
		score := 0
		for _, keyword := range rule.Keywords {
			if strings.Contains(corpus, keyword) {
				score++
			}
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
