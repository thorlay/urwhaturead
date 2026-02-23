package feedextract

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"quick/internal/textclean"

	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
)

var (
	replyCountWordAfterExpr  = regexp.MustCompile(`(?i)(\d{1,7})\s*(?:comments?|repl(?:y|ies)|条?回复|评论)`)
	replyCountWordBeforeExpr = regexp.MustCompile(`(?i)(?:comments?|repl(?:y|ies)|回复|评论)\s*[:：]?\s*(\d{1,7})`)
	replyCountDigitExpr      = regexp.MustCompile(`\d{1,7}`)
	replyCountKnownKeys      = map[string]struct{}{
		"comment":      {},
		"comments":     {},
		"reply":        {},
		"replies":      {},
		"commentcount": {},
		"numcomments":  {},
		"total":        {},
	}
)

func ReplyCountFromFeedItem(item *gofeed.Item) *int {
	if item == nil {
		return nil
	}
	if value, ok := replyCountFromExtensions(item.Extensions); ok {
		return intPtr(value)
	}
	if value, ok := replyCountFromTexts(item.Title, item.Description, item.Content); ok {
		return intPtr(value)
	}
	return nil
}

func ReplyCountFromRaw(raw []byte) *int {
	if len(raw) == 0 {
		return nil
	}

	var item rawItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil
	}

	if value, ok := replyCountFromExtensions(item.Extensions); ok {
		return intPtr(value)
	}
	if value, ok := replyCountFromTexts(item.Title, item.Description, item.Content); ok {
		return intPtr(value)
	}
	return nil
}

func replyCountFromExtensions(extensions ext.Extensions) (int, bool) {
	if len(extensions) == 0 {
		return 0, false
	}

	best := -1
	for namespaceName, namespace := range extensions {
		ns := normalizeReplyCountToken(namespaceName)
		for keyName, entries := range namespace {
			key := normalizeReplyCountToken(keyName)
			allowKey := shouldInspectReplyCountKey(ns, key)
			for _, entry := range entries {
				if !allowKey && !hasReplyCountHint(entry.Value) {
					continue
				}

				candidates := []string{
					entry.Value,
					entry.Attrs["count"],
					entry.Attrs["total"],
					entry.Attrs["num"],
					entry.Attrs["comments"],
					entry.Attrs["comment"],
					entry.Attrs["replies"],
					entry.Attrs["reply"],
				}
				for _, candidate := range candidates {
					if value, ok := parseReplyCountNumber(candidate); ok && value > best {
						best = value
					}
				}
			}
		}
	}
	if best < 0 {
		return 0, false
	}
	return best, true
}

func replyCountFromTexts(values ...string) (int, bool) {
	best := -1
	for _, raw := range values {
		text := textclean.NormalizeFromHTML(raw)
		if text == "" {
			text = textclean.NormalizeInline(raw)
		}
		if text == "" {
			continue
		}

		for _, expr := range []*regexp.Regexp{replyCountWordAfterExpr, replyCountWordBeforeExpr} {
			match := expr.FindStringSubmatch(text)
			if len(match) < 2 {
				continue
			}
			if value, ok := parseReplyCountNumber(match[1]); ok && value > best {
				best = value
			}
		}
	}
	if best < 0 {
		return 0, false
	}
	return best, true
}

func shouldInspectReplyCountKey(namespace string, key string) bool {
	if _, ok := replyCountKnownKeys[key]; ok {
		return true
	}
	if strings.Contains(key, "comment") || strings.Contains(key, "repl") {
		return true
	}
	if namespace == "slash" || namespace == "thread" || namespace == "thr" {
		return true
	}
	return false
}

func hasReplyCountHint(raw string) bool {
	value := normalizeReplyCountToken(raw)
	return strings.Contains(value, "comment") || strings.Contains(value, "repl") || strings.Contains(value, "回复") || strings.Contains(value, "评论")
}

func parseReplyCountNumber(raw string) (int, bool) {
	value := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if value == "" {
		return 0, false
	}
	value = strings.Trim(value, "\"'")
	if value == "" {
		return 0, false
	}
	if value == "0" {
		return 0, true
	}

	if direct, err := strconv.Atoi(value); err == nil && direct >= 0 {
		return direct, true
	}

	digits := replyCountDigitExpr.FindString(value)
	if digits == "" {
		return 0, false
	}
	parsed, err := strconv.Atoi(digits)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

func normalizeReplyCountToken(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func intPtr(value int) *int {
	v := value
	return &v
}
