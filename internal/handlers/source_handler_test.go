package handlers

import (
	"net/url"
	"testing"
)

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
