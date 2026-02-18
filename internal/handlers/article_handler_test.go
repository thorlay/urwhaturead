package handlers

import "testing"

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
