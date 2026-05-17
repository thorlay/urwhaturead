package handlers

import (
	"net/http"
	"net/url"
	"testing"
)

func TestNewSourceHandler_RedditClientDisablesHTTP2(t *testing.T) {
	handler := NewSourceHandler(nil, nil)
	transport, ok := handler.redditHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("reddit transport type=%T, want *http.Transport", handler.redditHTTPClient.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("expected reddit transport ForceAttemptHTTP2=false")
	}
	if transport.TLSNextProto == nil {
		t.Fatalf("expected reddit transport TLSNextProto to disable http/2")
	}
}

func TestNormalizeSiteKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "strip subdomain",
			input: "https://www.uscardforum.com/top.rss",
			want:  "uscardforum.com",
		},
		{
			name:  "multi level tld",
			input: "https://news.bbc.co.uk/rss.xml",
			want:  "bbc.co.uk",
		},
		{
			name:  "rsshub provider should use first path segment",
			input: "https://rsshub.rssforever.com/1point3acres/thread/hot",
			want:  "1point3acres",
		},
		{
			name:  "rsshub app should use first path segment",
			input: "https://rsshub.app/v2ex/topics/hot",
			want:  "v2ex",
		},
		{
			name:  "localhost",
			input: "http://localhost:8080/feed.xml",
			want:  "localhost",
		},
		{
			name:  "loopback rsshub should use first path segment",
			input: "http://127.0.0.1:1200/v2ex/topics/hot",
			want:  "v2ex",
		},
		{
			name:  "private ip rsshub should use first path segment",
			input: "http://10.0.0.12:1200/dapenti/tugua",
			want:  "dapenti",
		},
		{
			name:  "invalid url",
			input: "not-a-url",
			want:  "unknown-site",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSiteKey(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeSiteKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFallbackSourceNameFromURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "loopback rsshub should use first path segment",
			input: "http://127.0.0.1:1200/dapenti/tugua",
			want:  "dapenti",
		},
		{
			name:  "regular host should fallback to hostname",
			input: "https://feeds.bbci.co.uk/news/rss.xml",
			want:  "feeds.bbci.co.uk",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fallbackSourceNameFromURL(tt.input)
			if got != tt.want {
				t.Fatalf("fallbackSourceNameFromURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeDisplaySourceName(t *testing.T) {
	tests := []struct {
		name        string
		currentName string
		rssURL      string
		want        string
	}{
		{
			name:        "local rsshub hostname should map to first segment",
			currentName: "127.0.0.1",
			rssURL:      "http://127.0.0.1:1200/dapenti/tugua",
			want:        "dapenti",
		},
		{
			name:        "explicit custom name should be kept",
			currentName: "我的论坛源",
			rssURL:      "http://127.0.0.1:1200/v2ex/topics/hot",
			want:        "我的论坛源",
		},
		{
			name:        "empty name should use fallback",
			currentName: "",
			rssURL:      "http://127.0.0.1:1200/v2ex/topics/hot",
			want:        "v2ex",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeDisplaySourceName(tt.currentName, tt.rssURL)
			if got != tt.want {
				t.Fatalf("normalizeDisplaySourceName(%q, %q) = %q, want %q", tt.currentName, tt.rssURL, got, tt.want)
			}
		})
	}
}

func TestNormalizeDiscoverInputURL(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantURL string
		wantErr bool
	}{
		{
			name:    "add https scheme",
			input:   "example.com",
			wantURL: "https://example.com/",
		},
		{
			name:    "keep existing scheme",
			input:   "http://example.com/feed.xml",
			wantURL: "http://example.com/feed.xml",
		},
		{
			name:    "reject unsupported scheme",
			input:   "ftp://example.com/rss.xml",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeDiscoverInputURL(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.String() != tt.wantURL {
				t.Fatalf("normalizeDiscoverInputURL(%q) = %q, want %q", tt.input, got.String(), tt.wantURL)
			}
		})
	}
}

func TestExtractFeedLinksFromHTML(t *testing.T) {
	body := []byte(`
<html>
  <head>
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
  </head>
  <body>
    <a href="https://example.com/news.rss">RSS Link</a>
  </body>
</html>
`)
	got := extractFeedLinksFromHTML("https://example.com/blog", body)
	if len(got) != 3 {
		t.Fatalf("expected 3 feeds, got %d (%v)", len(got), got)
	}
}

func TestExtractSitemapURLsFromRobots(t *testing.T) {
	robots := `
User-agent: *
Disallow:
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news-sitemap.xml
`
	got := extractSitemapURLsFromRobots(robots)
	if len(got) != 2 {
		t.Fatalf("expected 2 sitemap urls, got %d", len(got))
	}
}

func TestNormalizeCandidateURL(t *testing.T) {
	base, _ := url.Parse("https://example.com/blog/")
	got, ok := normalizeCandidateURL(base, "/feed.xml")
	if !ok {
		t.Fatalf("normalizeCandidateURL should be valid")
	}
	if got != "https://example.com/feed.xml" {
		t.Fatalf("got %q", got)
	}
}

func TestExpandRSSHubAliasURL(t *testing.T) {
	tests := []struct {
		name    string
		rawURL  string
		baseURL string
		want    string
		wantErr bool
	}{
		{
			name:    "expand basic rsshub alias",
			rawURL:  "rsshub://douban/list/EC645NBAI",
			baseURL: "http://127.0.0.1:1200",
			want:    "http://127.0.0.1:1200/douban/list/EC645NBAI",
		},
		{
			name:    "preserve query string",
			rawURL:  "rsshub://reddit/r/golang/hot?limit=50",
			baseURL: "http://127.0.0.1:1200",
			want:    "http://127.0.0.1:1200/reddit/r/golang/hot?limit=50",
		},
		{
			name:    "support base path prefix",
			rawURL:  "rsshub://v2ex/topics/hot",
			baseURL: "https://rss.example.com/rss",
			want:    "https://rss.example.com/rss/v2ex/topics/hot",
		},
		{
			name:    "non rsshub url unchanged",
			rawURL:  "https://hnrss.org/best",
			baseURL: "http://127.0.0.1:1200",
			want:    "https://hnrss.org/best",
		},
		{
			name:    "invalid alias route",
			rawURL:  "rsshub://",
			baseURL: "http://127.0.0.1:1200",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := expandRSSHubAliasURL(tt.rawURL, tt.baseURL)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (%q)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expandRSSHubAliasURL(%q, %q)=%q, want=%q", tt.rawURL, tt.baseURL, got, tt.want)
			}
		})
	}
}

func TestNormalizeRSSHubBaseURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "default when empty",
			input: "",
			want:  "http://127.0.0.1:1200",
		},
		{
			name:  "keep valid input",
			input: "https://rss.local:1200/",
			want:  "https://rss.local:1200/",
		},
		{
			name:  "fallback when invalid",
			input: "://bad",
			want:  "http://127.0.0.1:1200",
		},
		{
			name:  "fallback when unsupported scheme",
			input: "ftp://rss.local:1200",
			want:  "http://127.0.0.1:1200",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeRSSHubBaseURL(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeRSSHubBaseURL(%q)=%q, want=%q", tt.input, got, tt.want)
			}
		})
	}
}

func TestResolveSourceTag(t *testing.T) {
	tests := []struct {
		name      string
		requested string
		rssURL    string
		probe     *probeResult
		want      string
	}{
		{
			name:      "keep explicit tag",
			requested: "world",
			rssURL:    "https://hnrss.org/frontpage",
			want:      "world",
		},
		{
			name:      "infer by host rule",
			requested: "general",
			rssURL:    "https://hnrss.org/frontpage",
			want:      "tech",
		},
		{
			name:      "infer by rsshub path rule",
			requested: "general",
			rssURL:    "https://rsshub.rssforever.com/reddit/r/golang/hot",
			want:      "forum",
		},
		{
			name:      "infer by keyword score fallback",
			requested: "",
			rssURL:    "https://example.com/feed.xml",
			probe: &probeResult{
				Title: "Markets and stocks daily briefing",
				SampleText: []string{
					"Fed rate decision and investing strategy",
				},
			},
			want: "finance",
		},
		{
			name:      "fallback to general on low confidence",
			requested: "general",
			rssURL:    "https://example.com/feed.xml",
			probe: &probeResult{
				Title:      "Random updates",
				SampleText: []string{"hello world"},
			},
			want: "general",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveSourceTag(tt.requested, tt.rssURL, tt.probe)
			if got != tt.want {
				t.Fatalf("resolveSourceTag(...)=%q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolveSourceTagWithRecentText(t *testing.T) {
	got, reason := resolveSourceTagWithRecentText(
		"general",
		"https://example.com/feed.xml",
		nil,
		[]string{
			"美股市场继续上涨，投资者关注美联储利率路径和银行财报",
			"债券收益率回落，基金经理重新评估科技股估值",
		},
	)
	if got != "finance" {
		t.Fatalf("resolveSourceTagWithRecentText() tag=%q, want finance", got)
	}
	if reason != "recent_articles" {
		t.Fatalf("resolveSourceTagWithRecentText() reason=%q, want recent_articles", reason)
	}
}

func TestInferSourceTagByRecentTextDoesNotMatchShortASCIIInsideWords(t *testing.T) {
	got := inferSourceTagByRecentText([]string{
		"daily paid email campaign update",
		"plain status note without technology terms",
	})
	if got != "" {
		t.Fatalf("inferSourceTagByRecentText()=%q, want empty", got)
	}
}

func TestShouldAutoInferTag(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{input: "", want: true},
		{input: "general", want: true},
		{input: " General ", want: true},
		{input: "auto", want: true},
		{input: "tech", want: false},
	}

	for _, tt := range tests {
		got := shouldAutoInferTag(tt.input)
		if got != tt.want {
			t.Fatalf("shouldAutoInferTag(%q)=%v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestShouldInferFromProvidedTags(t *testing.T) {
	tests := []struct {
		name string
		tags []string
		want bool
	}{
		{name: "empty tags", tags: nil, want: true},
		{name: "single general", tags: []string{"general"}, want: true},
		{name: "single auto", tags: []string{"auto"}, want: true},
		{name: "single explicit", tags: []string{"tech"}, want: false},
		{name: "multiple explicit", tags: []string{"general", "tech"}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldInferFromProvidedTags(tt.tags)
			if got != tt.want {
				t.Fatalf("shouldInferFromProvidedTags(%v)=%v, want %v", tt.tags, got, tt.want)
			}
		})
	}
}

func TestMergeSourceTags(t *testing.T) {
	tests := []struct {
		name string
		tags []string
		want []string
	}{
		{
			name: "empty tags fallback to default",
			tags: nil,
			want: []string{"general"},
		},
		{
			name: "dedupe and trim",
			tags: []string{" AI ", "tech", "ai", ""},
			want: []string{"ai", "tech"},
		},
		{name: "keep explicit tags", tags: []string{"forum"}, want: []string{"forum"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mergeSourceTags(tt.tags)
			if len(got) != len(tt.want) {
				t.Fatalf("mergeSourceTags() len=%d want=%d got=%v", len(got), len(tt.want), got)
			}
			for idx := range tt.want {
				if got[idx] != tt.want[idx] {
					t.Fatalf("mergeSourceTags()[%d]=%q want=%q", idx, got[idx], tt.want[idx])
				}
			}
		})
	}
}

func TestShouldResetSourceFetchState(t *testing.T) {
	tests := []struct {
		name     string
		previous string
		next     string
		want     bool
	}{
		{
			name:     "same canonical url should not reset",
			previous: "https://www.reddit.com/r/technology/top.rss/",
			next:     "https://www.reddit.com/r/technology/top.rss",
			want:     false,
		},
		{
			name:     "query change should reset",
			previous: "https://www.reddit.com/r/technology/top.rss",
			next:     "https://www.reddit.com/r/technology/top.rss?t=day",
			want:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldResetSourceFetchState(tt.previous, tt.next)
			if got != tt.want {
				t.Fatalf("shouldResetSourceFetchState(%q, %q)=%v, want %v", tt.previous, tt.next, got, tt.want)
			}
		})
	}
}

func TestApplySourceTagBulkAction(t *testing.T) {
	tests := []struct {
		name    string
		current []string
		tags    []string
		action  string
		want    []string
	}{
		{
			name:    "add should merge and dedupe",
			current: []string{"tech", "forum"},
			tags:    []string{"finance", "tech"},
			action:  "add",
			want:    []string{"tech", "forum", "finance"},
		},
		{
			name:    "remove should keep remaining tags",
			current: []string{"tech", "forum", "finance"},
			tags:    []string{"forum"},
			action:  "remove",
			want:    []string{"tech", "finance"},
		},
		{
			name:    "remove all should fallback to default",
			current: []string{"forum"},
			tags:    []string{"forum"},
			action:  "remove",
			want:    []string{"general"},
		},
		{
			name:    "replace should use provided tags",
			current: []string{"tech"},
			tags:    []string{"finance", "macro"},
			action:  "replace",
			want:    []string{"finance", "macro"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := applySourceTagBulkAction(tt.current, tt.tags, tt.action)
			if len(got) != len(tt.want) {
				t.Fatalf("applySourceTagBulkAction len=%d want=%d got=%v", len(got), len(tt.want), got)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Fatalf("applySourceTagBulkAction[%d]=%q want=%q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestNormalizeSourceKindValue(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty defaults feed", input: "", want: "feed"},
		{name: "feed stays feed", input: "feed", want: "feed"},
		{name: "thread stays thread", input: "thread", want: "thread"},
		{name: "unknown defaults feed", input: "unknown", want: "feed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSourceKindValue(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeSourceKindValue(%q)=%q, want=%q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseSourceImportPayload(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantCount int
		wantErr   bool
	}{
		{
			name:      "object payload",
			raw:       `{"sources":[{"name":"HN","rss_url":"https://hnrss.org/best"}]}`,
			wantCount: 1,
		},
		{
			name:      "array payload",
			raw:       `[{"name":"HN","rss_url":"https://hnrss.org/best"}]`,
			wantCount: 1,
		},
		{
			name:      "wrapped data payload",
			raw:       `{"data":{"sources":[{"name":"HN","rss_url":"https://hnrss.org/best"}]}}`,
			wantCount: 1,
		},
		{
			name:    "invalid payload",
			raw:     `not-json`,
			wantErr: true,
		},
		{
			name:    "empty payload",
			raw:     ``,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload, err := parseSourceImportPayload([]byte(tt.raw))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil payload=%+v", payload)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(payload.Sources) != tt.wantCount {
				t.Fatalf("len(payload.Sources)=%d, want=%d", len(payload.Sources), tt.wantCount)
			}
		})
	}
}
