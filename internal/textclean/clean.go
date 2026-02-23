package textclean

import (
	"html"
	"regexp"
	"strings"
)

var (
	htmlTagPattern        = regexp.MustCompile(`<[^>]*>`)
	spacePattern          = regexp.MustCompile(`\s+`)
	inlineSpacePattern    = regexp.MustCompile(`[ \t\f\v]+`)
	lineBreakTagPattern   = regexp.MustCompile(`(?i)<br\s*/?>`)
	blockCloseTagPattern  = regexp.MustCompile(`(?i)</(?:p|div|section|article|blockquote|h[1-6]|pre|ul|ol|table|tbody|thead|tfoot)>`)
	listItemOpenPattern   = regexp.MustCompile(`(?i)<li[^>]*>`)
	listItemClosePattern  = regexp.MustCompile(`(?i)</li>`)
	tableCellClosePattern = regexp.MustCompile(`(?i)</t[dh]>`)
	tableRowClosePattern  = regexp.MustCompile(`(?i)</tr>`)
	spaceBeforeNLPattern  = regexp.MustCompile(`[ \t]+\n`)
	spaceAfterNLPattern   = regexp.MustCompile(`\n[ \t]+`)
	multiNLPattern        = regexp.MustCompile(`\n{4,}`)
	redditSubmittedByExpr = regexp.MustCompile(`(?i)\bsubmitted by\s+\/?u\/[a-z0-9_-]+`)
	redditMetaTokenExpr   = regexp.MustCompile(`(?i)\[\s*(?:link|comments?)\s*\]`)
)

// NormalizeInline decodes entities and removes common feed noise while keeping non-HTML text.
func NormalizeInline(raw string) string {
	return normalize(raw, false)
}

// NormalizeFromHTML does NormalizeInline and also strips HTML tags.
func NormalizeFromHTML(raw string) string {
	return normalize(raw, true)
}

// NormalizeFromHTMLBlock keeps meaningful paragraph/list line breaks for long-form reading.
func NormalizeFromHTMLBlock(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}

	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\u00a0", " ")
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")

	value = lineBreakTagPattern.ReplaceAllString(value, "\n")
	value = blockCloseTagPattern.ReplaceAllString(value, "\n\n")
	value = listItemOpenPattern.ReplaceAllString(value, "- ")
	value = listItemClosePattern.ReplaceAllString(value, "\n")
	value = tableCellClosePattern.ReplaceAllString(value, " ")
	value = tableRowClosePattern.ReplaceAllString(value, "\n")
	value = htmlTagPattern.ReplaceAllString(value, " ")

	value = stripFeedBoilerplate(value)
	value = inlineSpacePattern.ReplaceAllString(value, " ")
	value = spaceBeforeNLPattern.ReplaceAllString(value, "\n")
	value = spaceAfterNLPattern.ReplaceAllString(value, "\n")
	value = multiNLPattern.ReplaceAllString(value, "\n\n\n")

	return strings.TrimSpace(value)
}

func normalize(raw string, stripHTML bool) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}

	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\u00a0", " ")
	if stripHTML {
		value = htmlTagPattern.ReplaceAllString(value, " ")
	}
	value = stripFeedBoilerplate(value)
	value = spacePattern.ReplaceAllString(value, " ")

	return strings.TrimSpace(value)
}

func stripFeedBoilerplate(value string) string {
	value = redditSubmittedByExpr.ReplaceAllString(value, " ")
	value = redditMetaTokenExpr.ReplaceAllString(value, " ")
	return value
}
