package feedextract

import (
	"net/url"
	"regexp"
	"strings"
)

var arxivPaperID = regexp.MustCompile(`^\d{4}\.\d{4,5}(?:v\d+)?$`)

func ArxivID(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	if host != "arxiv.org" && host != "www.arxiv.org" && host != "huggingface.co" {
		return "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 2 {
		return "", false
	}
	if host == "huggingface.co" {
		if parts[0] != "papers" {
			return "", false
		}
	} else if parts[0] != "abs" && parts[0] != "html" && parts[0] != "pdf" {
		return "", false
	}
	id := strings.TrimSuffix(parts[1], ".pdf")
	if !arxivPaperID.MatchString(id) {
		return "", false
	}
	return strings.Split(id, "v")[0], true
}
