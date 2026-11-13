package handlers

import (
	"net/url"
	"strings"

	"quick/internal/feedextract"
)

// Worker-provided discussion text must be exposed separately from the feed's
// original HTML main post, which otherwise takes precedence in the reader.
func ngaSavedDiscussion(article articleDetail) *articleThread {
	tid, ok := feedextract.NGAThreadID(article.Link)
	if !ok || article.Content == nil {
		return nil
	}
	main, replies, found := strings.Cut(*article.Content, "\n[NGA 回复材料")
	if !found {
		return nil
	}
	thread := &articleThread{
		TopicURL:    "https://nga.178.com/read.php?tid=" + tid,
		TopicTitle:  article.Title,
		FullContent: strings.TrimSpace(strings.TrimPrefix(main, "[NGA 主帖]")),
		Comments:    []articleThreadComment{},
	}
	u, err := url.Parse(article.SourceRSSURL)
	if err == nil {
		if index := strings.LastIndex(u.Path, "/nga/forum/"); index >= 0 {
			u.Path, u.RawQuery, u.Fragment = u.Path[:index]+"/nga/post/"+tid, "", ""
			thread.FeedURL = u.String()
		}
	}
	for _, block := range strings.Split(replies, "\n楼层作者：")[1:] {
		author, rest, ok := strings.Cut(block, "\n楼层链接：")
		if !ok {
			continue
		}
		link, body, ok := strings.Cut(rest, "\n")
		if !ok || strings.TrimSpace(body) == "" {
			continue
		}
		if replyTID, valid := feedextract.NGAThreadID(strings.TrimSpace(link)); !valid || replyTID != tid {
			continue
		}
		thread.Comments = append(thread.Comments, articleThreadComment{
			Author: strings.TrimSpace(author), Link: strings.TrimSpace(link), Content: strings.TrimSpace(body),
		})
	}
	thread.TotalPosts = len(thread.Comments) + 1
	return thread
}

func needsNGAThreadEnrichment(link string, cached articleEnrichmentResult) bool {
	_, nga := feedextract.NGAThreadID(link)
	return nga && cached.Thread == nil
}
