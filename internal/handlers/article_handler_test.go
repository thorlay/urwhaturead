package handlers

import (
	"testing"
	"time"
)

func TestUSCardTopicRSSURL(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantFeed  string
		wantTopic string
		wantOK    bool
	}{
		{
			name:      "topic root url",
			input:     "https://www.uscardforum.com/t/topic/483864",
			wantFeed:  "https://www.uscardforum.com/t/topic/483864.rss",
			wantTopic: "https://www.uscardforum.com/t/topic/483864",
			wantOK:    true,
		},
		{
			name:      "post permalink url",
			input:     "https://www.uscardforum.com/t/topic/483864/17",
			wantFeed:  "https://www.uscardforum.com/t/topic/483864.rss",
			wantTopic: "https://www.uscardforum.com/t/topic/483864",
			wantOK:    true,
		},
		{
			name:   "non uscard url",
			input:  "https://news.ycombinator.com/item?id=1",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			feedURL, topicURL, ok := uscardTopicRSSURL(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !tt.wantOK {
				return
			}
			if feedURL != tt.wantFeed {
				t.Fatalf("feedURL = %q, want %q", feedURL, tt.wantFeed)
			}
			if topicURL != tt.wantTopic {
				t.Fatalf("topicURL = %q, want %q", topicURL, tt.wantTopic)
			}
		})
	}
}

func TestV2exTopicRSSURLs(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantFeeds []string
		wantTopic string
		wantOK    bool
	}{
		{
			name:  "topic root url",
			input: "https://www.v2ex.com/t/1095695",
			wantFeeds: []string{
				"https://rsshub.rssforever.com/v2ex/post/1095695",
			},
			wantTopic: "https://www.v2ex.com/t/1095695",
			wantOK:    true,
		},
		{
			name:  "topic with reply anchor",
			input: "https://www.v2ex.com/t/1095695#reply7",
			wantFeeds: []string{
				"https://rsshub.rssforever.com/v2ex/post/1095695",
			},
			wantTopic: "https://www.v2ex.com/t/1095695",
			wantOK:    true,
		},
		{
			name:   "non v2ex url",
			input:  "https://news.ycombinator.com/item?id=1",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			feedURLs, topicURL, ok := v2exTopicRSSURLs(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !tt.wantOK {
				return
			}
			if len(feedURLs) != len(tt.wantFeeds) {
				t.Fatalf("len(feedURLs) = %d, want %d", len(feedURLs), len(tt.wantFeeds))
			}
			for i := range feedURLs {
				if feedURLs[i] != tt.wantFeeds[i] {
					t.Fatalf("feedURLs[%d] = %q, want %q", i, feedURLs[i], tt.wantFeeds[i])
				}
			}
			if topicURL != tt.wantTopic {
				t.Fatalf("topicURL = %q, want %q", topicURL, tt.wantTopic)
			}
		})
	}
}

func TestRedditTopicRSSURLs(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantFeeds []string
		wantTopic string
		wantOK    bool
	}{
		{
			name:  "reddit submission link",
			input: "https://www.reddit.com/r/golang/comments/abc123/hello_world/",
			wantFeeds: []string{
				"https://www.reddit.com/r/golang/comments/abc123/.rss",
				"https://www.reddit.com/comments/abc123/.rss",
			},
			wantTopic: "https://www.reddit.com/r/golang/comments/abc123",
			wantOK:    true,
		},
		{
			name:  "old reddit comment link",
			input: "https://old.reddit.com/r/golang/comments/abc123/hello_world/def456/?context=3",
			wantFeeds: []string{
				"https://www.reddit.com/r/golang/comments/abc123/.rss",
				"https://www.reddit.com/comments/abc123/.rss",
			},
			wantTopic: "https://www.reddit.com/r/golang/comments/abc123",
			wantOK:    true,
		},
		{
			name:  "redd it short link",
			input: "https://redd.it/abc123",
			wantFeeds: []string{
				"https://www.reddit.com/comments/abc123/.rss",
			},
			wantTopic: "https://www.reddit.com/comments/abc123",
			wantOK:    true,
		},
		{
			name:   "non reddit url",
			input:  "https://news.ycombinator.com/item?id=1",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			feedURLs, topicURL, ok := redditTopicRSSURLs(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !tt.wantOK {
				return
			}
			if len(feedURLs) != len(tt.wantFeeds) {
				t.Fatalf("len(feedURLs) = %d, want %d", len(feedURLs), len(tt.wantFeeds))
			}
			for i := range feedURLs {
				if feedURLs[i] != tt.wantFeeds[i] {
					t.Fatalf("feedURLs[%d] = %q, want %q", i, feedURLs[i], tt.wantFeeds[i])
				}
			}
			if topicURL != tt.wantTopic {
				t.Fatalf("topicURL = %q, want %q", topicURL, tt.wantTopic)
			}
		})
	}
}

func TestRedditPostNumberFromLink(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int
	}{
		{
			name:  "submission link",
			input: "https://www.reddit.com/r/golang/comments/abc123/hello_world/",
			want:  1,
		},
		{
			name:  "comment link",
			input: "https://www.reddit.com/r/golang/comments/abc123/hello_world/def456/",
			want:  2,
		},
		{
			name:  "short link treated as post",
			input: "https://redd.it/abc123",
			want:  1,
		},
		{
			name:  "non reddit",
			input: "https://example.com/post",
			want:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := redditPostNumberFromLink(tt.input)
			if got != tt.want {
				t.Fatalf("redditPostNumberFromLink(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestShouldFetchExternalArticle(t *testing.T) {
	tests := []struct {
		name       string
		sourceName string
		sourceRSS  string
		link       string
		want       bool
	}{
		{
			name:       "hn source and external link",
			sourceName: "HN Best",
			sourceRSS:  "https://hnrss.org/best",
			link:       "https://www.jeffgeerling.com/blog/2026/ai-is-destroying-open-source/",
			want:       true,
		},
		{
			name:       "hn comments link should skip",
			sourceName: "HN Best",
			sourceRSS:  "https://hnrss.org/best",
			link:       "https://news.ycombinator.com/item?id=123",
			want:       false,
		},
		{
			name:       "non hn source should skip",
			sourceName: "BBC",
			sourceRSS:  "https://feeds.bbci.co.uk/news/world/rss.xml",
			link:       "https://www.jeffgeerling.com/blog/2026/ai-is-destroying-open-source/",
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldFetchExternalArticle(tt.sourceName, tt.sourceRSS, tt.link)
			if got != tt.want {
				t.Fatalf("shouldFetchExternalArticle(...) = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNormalizeSiteKeyFromURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "rsshub rssforever uses first segment",
			input: "https://rsshub.rssforever.com/v2ex/topics/hot",
			want:  "v2ex",
		},
		{
			name:  "rsshub app uses first segment",
			input: "https://rsshub.app/v2ex/topics/hot",
			want:  "v2ex",
		},
		{
			name:  "normal host uses etld+1",
			input: "https://www.v2ex.com/index.xml",
			want:  "v2ex.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSiteKeyFromURL(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeSiteKeyFromURL(%q)=%q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestCollectThreadPostLinks(t *testing.T) {
	raw := `
<p>discussion</p>
<a href="https://example.com/story">external</a>
<a href="https://www.reddit.com/r/golang/comments/abc123/test/">reddit</a>
More: https://example.com/story
`
	links := collectThreadPostLinks(raw, "https://www.reddit.com/r/golang/comments/abc123/test/")
	if len(links) < 2 {
		t.Fatalf("expected at least 2 links, got %d (%v)", len(links), links)
	}
	if links[0] != "https://www.reddit.com/r/golang/comments/abc123/test/" {
		t.Fatalf("expected item link as first, got %q", links[0])
	}
}

func TestPickThreadExternalLink(t *testing.T) {
	post := threadPost{
		Link: "https://www.reddit.com/r/golang/comments/abc123/test/",
		Links: []string{
			"https://www.reddit.com/r/golang/comments/abc123/test/",
			"https://news.ycombinator.com/item?id=123",
			"https://example.com/blog/post",
		},
	}

	got := pickThreadExternalLink(
		post,
		"https://www.reddit.com/r/golang/comments/abc123",
		"https://www.reddit.com/r/golang/comments/abc123/.rss",
	)
	if got != "https://example.com/blog/post" {
		t.Fatalf("pickThreadExternalLink got=%q want=%q", got, "https://example.com/blog/post")
	}
}

func TestNormalizeThreadText_StripsRedditBoilerplate(t *testing.T) {
	input := `<p>&#32; submitted by &#32; /u/gdelacalle</p><p>[link] [comments]</p><p>正文内容</p>`
	got := normalizeThreadText(input)
	want := "正文内容"
	if got != want {
		t.Fatalf("normalizeThreadText(%q)=%q, want %q", input, got, want)
	}
}

func TestSanitizeArticleForOutput(t *testing.T) {
	summary := `submitted by /u/demo [link] [comments]`
	content := `<p>Hello&nbsp;world</p>`
	author := "  /u/demo  "
	detail := articleDetail{
		Title:   "AI&nbsp;Digest",
		Summary: &summary,
		Content: &content,
		Author:  &author,
	}

	sanitizeArticleForOutput(&detail)

	if detail.Title != "AI Digest" {
		t.Fatalf("detail.Title=%q, want %q", detail.Title, "AI Digest")
	}
	if detail.Summary != nil {
		t.Fatalf("detail.Summary=%v, want nil", detail.Summary)
	}
	if detail.Content == nil || *detail.Content != "Hello world" {
		t.Fatalf("detail.Content=%v, want %q", detail.Content, "Hello world")
	}
	if detail.Author == nil || *detail.Author != "/u/demo" {
		t.Fatalf("detail.Author=%v, want %q", detail.Author, "/u/demo")
	}
}

func TestNormalizeHostAllowlist(t *testing.T) {
	input := []string{
		"",
		" Example.com ",
		"https://WWW.EXAMPLE.com/path",
		"sub.example.com",
		"example.com",
	}
	got := normalizeHostAllowlist(input)
	want := []string{"example.com", "www.example.com", "sub.example.com"}
	if len(got) != len(want) {
		t.Fatalf("len(normalizeHostAllowlist)=%d, want=%d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeHostAllowlist[%d]=%q, want=%q", i, got[i], want[i])
		}
	}
}

func TestHostMatchesAllowRule(t *testing.T) {
	tests := []struct {
		name string
		host string
		rule string
		want bool
	}{
		{name: "exact", host: "example.com", rule: "example.com", want: true},
		{name: "subdomain for base", host: "a.example.com", rule: "example.com", want: true},
		{name: "wildcard subdomain", host: "a.example.com", rule: "*.example.com", want: true},
		{name: "wildcard does not match root", host: "example.com", rule: "*.example.com", want: false},
		{name: "different host", host: "example.net", rule: "example.com", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := hostMatchesAllowRule(tt.host, tt.rule)
			if got != tt.want {
				t.Fatalf("hostMatchesAllowRule(%q,%q)=%v, want=%v", tt.host, tt.rule, got, tt.want)
			}
		})
	}
}

func TestExternalFailureCache(t *testing.T) {
	handler := NewArticleHandlerWithOptions(nil, nil, ArticleHandlerOptions{
		ExternalFetchEnabled:    true,
		ExternalFetchEnabledSet: true,
		ExternalFetchFailureTTL: time.Hour,
	})
	if handler.contentSvc == nil {
		t.Fatalf("content service is nil")
	}
	now := time.Date(2026, 2, 22, 0, 0, 0, 0, time.UTC)
	url := "https://example.com/post"

	handler.contentSvc.setExternalFailure(url, now)
	if !handler.contentSvc.isExternalFailureCached(url, now.Add(30*time.Minute)) {
		t.Fatalf("expected failure cache hit before ttl")
	}
	if handler.contentSvc.isExternalFailureCached(url, now.Add(2*time.Hour)) {
		t.Fatalf("expected failure cache miss after ttl")
	}
}

func TestExternalBudgetLimitAndReset(t *testing.T) {
	handler := NewArticleHandlerWithOptions(nil, nil, ArticleHandlerOptions{
		ExternalFetchEnabled:      true,
		ExternalFetchEnabledSet:   true,
		ExternalFetchDailyReqMax:  2,
		ExternalFetchDailyByteMax: 10,
	})
	if handler.contentSvc == nil {
		t.Fatalf("content service is nil")
	}
	day1 := time.Date(2026, 2, 22, 10, 0, 0, 0, time.UTC)
	day2 := day1.Add(24 * time.Hour)

	if !handler.contentSvc.consumeExternalBudgetRequest(day1) {
		t.Fatalf("first request should pass")
	}
	if !handler.contentSvc.consumeExternalBudgetRequest(day1) {
		t.Fatalf("second request should pass")
	}
	if handler.contentSvc.consumeExternalBudgetRequest(day1) {
		t.Fatalf("third request should fail by req limit")
	}

	handler.contentSvc.consumeExternalBudgetBytes(day1, 10)
	if handler.contentSvc.consumeExternalBudgetRequest(day1) {
		t.Fatalf("request should fail by byte limit")
	}

	if !handler.contentSvc.consumeExternalBudgetRequest(day2) {
		t.Fatalf("next day should reset budget")
	}
}
