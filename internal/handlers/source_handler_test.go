package handlers

import "testing"

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
