package handlers

import (
	"crypto/tls"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func newHandlerHTTPClient(timeout time.Duration, disableHTTP2 bool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if disableHTTP2 {
		transport.ForceAttemptHTTP2 = false
		transport.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
		tlsConfig := transport.TLSClientConfig
		if tlsConfig != nil {
			tlsConfig = tlsConfig.Clone()
		} else {
			tlsConfig = &tls.Config{}
		}
		// Force ALPN to HTTP/1.1 so upstream cannot negotiate h2.
		tlsConfig.NextProtos = []string{"http/1.1"}
		transport.TLSClientConfig = tlsConfig
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}

func pickHTTPClientForURL(rawURL string, defaultClient *http.Client, redditClient *http.Client) *http.Client {
	if isRedditURL(rawURL) && redditClient != nil {
		return redditClient
	}
	return defaultClient
}

func isRedditURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	switch host {
	case "reddit.com", "www.reddit.com", "old.reddit.com", "np.reddit.com", "redd.it":
		return true
	default:
		return false
	}
}
