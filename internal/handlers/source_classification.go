package handlers

import (
	"strings"

	"quick/internal/models"
	"quick/internal/sourceclassify"
)

const defaultSourceTag = sourceclassify.DefaultTag

func normalizeSourceForResponse(source *models.Source) {
	if source == nil {
		return
	}
	source.Name = normalizeDisplaySourceName(source.Name, source.RSSURL)
	source.SiteKey = normalizeSiteKey(source.RSSURL)
	source.Tags = mergeSourceTags(source.Tags)
}

func mergeSourceTags(rawTags []string) models.StringArray {
	return models.StringArray(sourceclassify.MergeTags(rawTags))
}

func normalizeSourceTags(rawTags []string) models.StringArray {
	return models.StringArray(sourceclassify.NormalizeTags(rawTags))
}

func normalizeSourceTag(raw string) string {
	return sourceclassify.NormalizeTag(raw)
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
	return sourceclassify.ShouldAutoInferTag(tag)
}

func shouldInferFromProvidedTags(tags []string) bool {
	return sourceclassify.ShouldInferFromProvidedTags(tags)
}

func resolveSourceTag(requestedTag string, rssURL string, probe *probeResult) string {
	return sourceclassify.ResolveTag(requestedTag, rssURL, toClassificationProbe(probe))
}

func resolveSourceTagWithReason(requestedTag string, rssURL string, probe *probeResult) (string, string) {
	return sourceclassify.ResolveTagWithReason(requestedTag, rssURL, toClassificationProbe(probe))
}

func resolveSourceTagWithRecentText(requestedTag string, rssURL string, probe *probeResult, recentText []string) (string, string) {
	return sourceclassify.ResolveTagWithRecentText(requestedTag, rssURL, toClassificationProbe(probe), recentText)
}

func inferSourceTagByRecentText(recentText []string) string {
	return sourceclassify.InferTagByRecentText(recentText)
}

func equalStringArrays(left []string, right []string) bool {
	return sourceclassify.EqualTags(left, right)
}

func applySourceTagBulkAction(current []string, tags []string, action string) models.StringArray {
	return models.StringArray(sourceclassify.ApplyTagBulkAction(current, tags, action))
}

func compactArticleClassificationText(article models.Article) string {
	input := sourceclassify.ArticleTextInput{
		Title: article.Title,
		Tags:  article.Tags,
	}
	if article.Summary != nil {
		input.Summary = *article.Summary
	}
	if article.Content != nil {
		input.Content = *article.Content
	}
	return sourceclassify.CompactArticleText(input)
}

func toClassificationProbe(probe *probeResult) *sourceclassify.FeedProbe {
	if probe == nil {
		return nil
	}
	return &sourceclassify.FeedProbe{
		Title:      probe.Title,
		SampleText: probe.SampleText,
	}
}
