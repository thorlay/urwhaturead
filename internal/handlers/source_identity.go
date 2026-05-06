package handlers

import (
	"net"
	"net/url"
	"strings"

	"golang.org/x/net/publicsuffix"
)

func normalizeDisplaySourceName(currentName string, rssURL string) string {
	name := strings.TrimSpace(currentName)
	if name == "" {
		return fallbackSourceNameFromURL(rssURL)
	}

	u, err := url.Parse(strings.TrimSpace(rssURL))
	if err != nil || !isRSSHubProviderURL(u) {
		return name
	}

	host := strings.TrimSpace(u.Hostname())
	if host == "" {
		return name
	}
	if !strings.EqualFold(name, host) {
		return name
	}

	if segment := firstPathSegment(u.Path); segment != "" {
		return segment
	}
	return name
}

func fallbackSourceNameFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err == nil {
		if isRSSHubProviderURL(u) {
			if segment := firstPathSegment(u.Path); segment != "" {
				return segment
			}
		}
		host := strings.TrimSpace(u.Hostname())
		if host != "" {
			return host
		}
	}
	return "Unnamed Source"
}

func normalizeSiteKey(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "unknown-site"
	}
	host := strings.TrimSpace(strings.ToLower(u.Hostname()))
	if host == "" {
		return "unknown-site"
	}
	if isRSSHubProviderURL(u) {
		firstSegment := firstPathSegment(u.Path)
		if firstSegment != "" {
			return firstSegment
		}
	}
	eTLD1, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err == nil && strings.TrimSpace(eTLD1) != "" {
		return strings.ToLower(eTLD1)
	}
	return host
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

func isRSSHubHost(host string) bool {
	switch strings.TrimSpace(strings.ToLower(host)) {
	case "rsshub.rssforever.com", "rsshub.app", "www.rsshub.app":
		return true
	default:
		return false
	}
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
	if first == "" || strings.Contains(first, ".") {
		return false
	}
	return true
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
