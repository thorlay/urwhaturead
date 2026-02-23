package feedextract

import (
	"encoding/json"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
)

type rawItem struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	Image       *struct {
		URL string `json:"url"`
	} `json:"image"`
	Enclosures []struct {
		URL  string `json:"url"`
		Type string `json:"type"`
	} `json:"enclosures"`
	Extensions ext.Extensions `json:"extensions"`
}

func ContentHTMLFromRaw(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}

	var item rawItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return ""
	}

	if value := strings.TrimSpace(item.Content); looksLikeHTML(value) {
		return value
	}
	if value := strings.TrimSpace(item.Description); looksLikeHTML(value) {
		return value
	}
	return ""
}

func ImageFromRaw(raw []byte, baseURL string) string {
	if len(raw) == 0 {
		return ""
	}

	var item rawItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return ""
	}

	if item.Image != nil {
		if normalized := normalizeHTTPURL(item.Image.URL, baseURL); normalized != "" {
			return normalized
		}
	}

	for _, enclosure := range item.Enclosures {
		contentType := strings.ToLower(strings.TrimSpace(enclosure.Type))
		if strings.HasPrefix(contentType, "image/") || contentType == "" {
			if normalized := normalizeHTTPURL(enclosure.URL, baseURL); normalized != "" {
				return normalized
			}
		}
	}

	if fromExt := imageFromExtensions(item.Extensions, baseURL); fromExt != "" {
		return fromExt
	}

	for _, htmlValue := range []string{item.Content, item.Description} {
		if fromHTML := FirstImageFromHTML(htmlValue, baseURL); fromHTML != "" {
			return fromHTML
		}
	}

	return ""
}

func ImageFromFeedItem(item *gofeed.Item) string {
	if item == nil {
		return ""
	}
	baseURL := strings.TrimSpace(item.Link)

	if item.Image != nil {
		if normalized := normalizeHTTPURL(item.Image.URL, baseURL); normalized != "" {
			return normalized
		}
	}

	for _, enclosure := range item.Enclosures {
		contentType := strings.ToLower(strings.TrimSpace(enclosure.Type))
		if strings.HasPrefix(contentType, "image/") || contentType == "" {
			if normalized := normalizeHTTPURL(enclosure.URL, baseURL); normalized != "" {
				return normalized
			}
		}
	}

	if fromExt := imageFromExtensions(item.Extensions, baseURL); fromExt != "" {
		return fromExt
	}

	for _, htmlValue := range []string{item.Content, item.Description} {
		if fromHTML := FirstImageFromHTML(htmlValue, baseURL); fromHTML != "" {
			return fromHTML
		}
	}
	return ""
}

func FirstImageFromHTML(rawHTML string, baseURL string) string {
	value := strings.TrimSpace(rawHTML)
	if value == "" || !looksLikeHTML(value) {
		return ""
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(value))
	if err != nil {
		return ""
	}

	selection := doc.Find("img").First()
	if selection.Length() == 0 {
		return ""
	}

	attrNames := []string{"src", "data-src", "data-original", "data-lazy-src", "data-url", "srcset"}
	for _, name := range attrNames {
		attrValue, ok := selection.Attr(name)
		if !ok {
			continue
		}

		candidate := strings.TrimSpace(attrValue)
		if name == "srcset" {
			candidate = firstSrcsetURL(candidate)
		}
		if normalized := normalizeHTTPURL(candidate, baseURL); normalized != "" {
			return normalized
		}
	}

	return ""
}

func imageFromExtensions(extensions ext.Extensions, baseURL string) string {
	if len(extensions) == 0 {
		return ""
	}

	for _, namespace := range extensions {
		for _, entries := range namespace {
			for _, entry := range entries {
				medium := strings.ToLower(strings.TrimSpace(entry.Attrs["medium"]))
				contentType := strings.ToLower(strings.TrimSpace(entry.Attrs["type"]))
				if medium != "image" && !strings.HasPrefix(contentType, "image/") && medium != "" && contentType != "" {
					continue
				}

				for _, key := range []string{"url", "href", "src"} {
					if normalized := normalizeHTTPURL(entry.Attrs[key], baseURL); normalized != "" {
						return normalized
					}
				}
				if normalized := normalizeHTTPURL(entry.Value, baseURL); normalized != "" {
					return normalized
				}
			}
		}
	}

	return ""
}

func firstSrcsetURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	firstSet := strings.TrimSpace(strings.Split(value, ",")[0])
	if firstSet == "" {
		return ""
	}
	parts := strings.Fields(firstSet)
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func normalizeHTTPURL(rawURL string, baseURL string) string {
	value := strings.TrimSpace(rawURL)
	if value == "" {
		return ""
	}
	value = strings.Trim(value, "\"'")
	if value == "" {
		return ""
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}

	if !parsed.IsAbs() {
		base := strings.TrimSpace(baseURL)
		if base == "" {
			return ""
		}
		baseParsed, err := url.Parse(base)
		if err != nil {
			return ""
		}
		parsed = baseParsed.ResolveReference(parsed)
	}

	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "http" && scheme != "https" {
		return ""
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return ""
	}
	return parsed.String()
}

func looksLikeHTML(value string) bool {
	return strings.Contains(value, "<") && strings.Contains(value, ">")
}
