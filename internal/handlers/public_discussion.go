package handlers

import (
	"time"

	"quick/internal/forumpublic"
)

func savedPublicDiscussion(raw []byte, link, title, main string, now time.Time) (*articleThread, *forumpublic.Snapshot) {
	sample := forumpublic.FromRaw(raw)
	if sample == nil {
		return nil, nil
	}
	var feedURL, scope string
	switch sample.Kind {
	case forumpublic.Lobsters:
		feedURL = forumpublic.LobstersFeed
		scope = "Lobsters 讨论页中近 24 小时的可见回复。"
	case forumpublic.Bogleheads:
		feedURL = forumpublic.BogleheadsFeed
		scope = "Bogleheads 投资版近 24 小时已采到的回复，按标题归组，可能漏采。"
	}
	thread := &articleThread{
		TopicURL: link, TopicTitle: title, FullContent: main,
		FeedURL: feedURL, SampleScope: scope, Comments: []articleThreadComment{},
	}
	if sample.ExternalLink != "" {
		thread.ExternalLink = &sample.ExternalLink
	}
	for _, reply := range forumpublic.RecentReplies(sample.Replies, now) {
		valid := sameDiscussion(link, reply.Link)
		if sample.Kind == forumpublic.Bogleheads {
			// The public Atom entries are grouped by board and exact thread
			// subject at ingestion. Each sampled post keeps its Atom permalink.
			_, valid = forumpublic.BogleheadsPost(reply.Link)
		}
		if !valid {
			continue
		}
		thread.Comments = append(thread.Comments, articleThreadComment{
			Author: reply.Author, PublishedAt: &reply.At, Link: reply.Link,
			Content: reply.Content, Upvotes: reply.Upvotes,
		})
	}
	thread.TotalPosts = len(thread.Comments)
	if main != "" {
		thread.TotalPosts++
	}
	return thread, sample
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
