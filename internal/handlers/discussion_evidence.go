package handlers

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"quick/internal/feedextract"
	"quick/internal/textclean"
)

const discussionVersion = "discussion-v1"
const maxDiscussionReplies = 16

type discussionReference struct {
	ID          string     `json:"id"`
	Author      string     `json:"author"`
	Link        string     `json:"link"`
	Content     string     `json:"excerpt"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	Upvotes     *int       `json:"upvotes,omitempty"`
}
type discussionSample struct {
	Available     int        `json:"available_replies"`
	Analyzed      int        `json:"analyzed_replies"`
	ReportedTotal *int       `json:"reported_total_replies,omitempty"`
	Method        string     `json:"method"`
	ReadAt        time.Time  `json:"read_at"`
	FirstAt       *time.Time `json:"first_reply_at,omitempty"`
	LastAt        *time.Time `json:"last_reply_at,omitempty"`
	DatedReplies  int        `json:"dated_replies"`
	Partial       bool       `json:"partial"`
}
type discussionInput struct {
	ArticleID  uint64                `json:"article_id"`
	Title      string                `json:"title"`
	TopicURL   string                `json:"topic_url"`
	MainPost   string                `json:"main_post"`
	Model      string                `json:"model"`
	Revision   string                `json:"revision"`
	References []discussionReference `json:"references"`
	Sample     discussionSample      `json:"sample"`
}

func discussionRevision(article articleDetail, model string) string {
	content := ""
	if article.Content != nil {
		content = *article.Content
	}
	summary := ""
	if article.Summary != nil {
		summary = *article.Summary
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s|%s|%s|%s|%v", discussionVersion, article.ID, model, article.Link, content, summary, article.ReplyCountValue()))))
}
func (a articleDetail) ReplyCountValue() string {
	if a.ReplyCount == nil {
		return "unknown"
	}
	return strconv.Itoa(*a.ReplyCount)
}
func hnTopicID(article articleDetail) string {
	for _, link := range []string{article.Link, func() string {
		if article.RawGUID != nil {
			return *article.RawGUID
		}
		return ""
	}()} {
		u, err := url.Parse(link)
		if err == nil && u.Hostname() == "news.ycombinator.com" && u.Path == "/item" {
			id := u.Query().Get("id")
			if n, e := strconv.ParseUint(id, 10, 64); e == nil && n > 0 {
				return id
			}
		}
	}
	return ""
}
func eligibleDiscussion(article articleDetail) bool {
	return article.SourceTag == "forum" || feedextract.IsForumThread(article.Link) || hnTopicID(article) != "" || strings.Contains(article.SourceRSSURL, "/reddit/")
}

func sameDiscussion(topic, reply string) bool {
	t, err := url.Parse(topic)
	if err != nil {
		return false
	}
	r, err := url.Parse(reply)
	if err != nil || (r.Scheme != "http" && r.Scheme != "https") || r.User != nil {
		return false
	}
	if tid, ok := feedextract.NGAThreadID(topic); ok {
		rid, ok := feedextract.NGAThreadID(reply)
		return ok && tid == rid && strings.HasPrefix(r.Fragment, "postcontent")
	}
	if original, ok := feedextract.USCardTopicURL(topic); ok {
		other, ok := feedextract.USCardTopicURL(reply)
		return ok && original == other && r.Path != t.Path
	}
	host := func(s string) string {
		s = strings.TrimPrefix(s, "www.")
		if s == "old.reddit.com" || s == "np.reddit.com" {
			return "reddit.com"
		}
		return s
	}
	if host(t.Hostname()) != host(r.Hostname()) {
		return false
	}
	switch host(t.Hostname()) {
	case "v2ex.com":
		return strings.TrimRight(t.Path, "/") == strings.TrimRight(r.Path, "/") && strings.HasPrefix(r.Fragment, "reply")
	case "news.ycombinator.com":
		return r.Path == "/item" && r.Query().Get("id") != "" && r.Query().Get("id") != t.Query().Get("id")
	case "reddit.com":
		parts := strings.Split(t.Path, "/comments/")
		if len(parts) != 2 {
			return false
		}
		id := strings.Split(parts[1], "/")[0]
		return strings.Contains(r.Path, "/comments/"+id+"/") && r.Path != t.Path
	}
	return false
}

func selectDiscussionReplies(topic string, comments []articleThreadComment, total *int, method string) ([]discussionReference, discussionSample) {
	valid := []articleThreadComment{}
	seen := map[string]bool{}
	for _, c := range comments {
		if !sameDiscussion(topic, c.Link) || seen[c.Link] {
			continue
		}
		c.Content = textclean.NormalizeFromHTMLBlock(c.Content)
		if strings.TrimSpace(c.Content) == "" || c.Content == "[deleted]" || c.Content == "[removed]" || c.Content == "该回复已删除" || c.Content == "此帖已被删除" {
			continue
		}
		seen[c.Link] = true
		valid = append(valid, c)
	}
	sample := discussionSample{Available: len(valid), ReportedTotal: total, Method: method, ReadAt: time.Now().UTC(), Partial: true}
	indices := []int{}
	chosen := map[int]bool{}
	add := func(i int) {
		if i >= 0 && i < len(valid) && !chosen[i] && len(indices) < maxDiscussionReplies {
			chosen[i] = true
			indices = append(indices, i)
		}
	}
	if len(valid) <= maxDiscussionReplies {
		for i := range valid {
			add(i)
		}
	} else {
		order := make([]int, len(valid))
		for i := range order {
			order[i] = i
		}
		sort.SliceStable(order, func(i, j int) bool {
			a, b := valid[order[i]].Upvotes, valid[order[j]].Upvotes
			return a != nil && (b == nil || *a > *b)
		})
		for _, i := range order[:2] {
			if valid[i].Upvotes != nil {
				add(i)
			}
		}
		for i := 0; i < 14; i++ {
			add(i * (len(valid) - 1) / 13)
		}
		for i := range valid {
			add(i)
		}
	}
	sort.Ints(indices)
	refs := make([]discussionReference, 0, len(indices))
	for _, i := range indices {
		c := valid[i]
		refs = append(refs, discussionReference{ID: fmt.Sprintf("R%02d", len(refs)+1), Author: textclean.NormalizeInline(c.Author), Link: c.Link, Content: truncateFeedText(c.Content, 700), PublishedAt: c.PublishedAt, Upvotes: c.Upvotes})
		if c.PublishedAt != nil {
			sample.DatedReplies++
			if sample.FirstAt == nil || c.PublishedAt.Before(*sample.FirstAt) {
				sample.FirstAt = c.PublishedAt
			}
			if sample.LastAt == nil || c.PublishedAt.After(*sample.LastAt) {
				sample.LastAt = c.PublishedAt
			}
		}
	}
	if len(valid) > maxDiscussionReplies {
		sample.Method += " 按返回顺序间隔抽样；有赞数时额外保留最多2条高赞回复。"
	} else {
		sample.Method += " 本次未再缩减接口返回的有效回复。"
	}
	sample.Analyzed = len(refs)
	return refs, sample
}

func (h *ArticleHandler) loadDiscussionInput(ctx context.Context, article articleDetail, model string) (discussionInput, error) {
	input := discussionInput{ArticleID: article.ID, Title: article.Title, TopicURL: article.Link, Model: model, Revision: discussionRevision(article, model)}
	if article.Content != nil {
		input.MainPost = *article.Content
	} else if article.Summary != nil {
		input.MainPost = *article.Summary
	}
	input.MainPost, _, _ = strings.Cut(input.MainPost, "\n[NGA 回复材料")
	input.MainPost = truncateFeedText(textclean.NormalizeFromHTMLBlock(input.MainPost), 900)
	var comments []articleThreadComment
	total := article.ReplyCount
	method := "接口返回的回复快照，可能使用5分钟缓存。"
	if tid := hnTopicID(article); tid != "" {
		input.TopicURL = "https://news.ycombinator.com/item?id=" + tid
		var err error
		comments, total, input.MainPost, err = fetchHNDiscussion(ctx, tid)
		if err != nil {
			return input, err
		}
		method = "HN 接口返回的部分主回复及子回复，再按返回顺序抽样；接口排序不代表赞同人数或完整时间序。"
	} else {
		thread, ok := h.contentSvc.fetchThreadForTopic(ctx, article.Link)
		if ok && thread != nil {
			comments = thread.Comments
		} else if article.Thread != nil {
			comments = article.Thread.Comments
		}
	}
	input.MainPost = truncateFeedText(textclean.NormalizeFromHTMLBlock(input.MainPost), 900)
	input.References, input.Sample = selectDiscussionReplies(input.TopicURL, comments, total, method)
	if len(input.References) < 2 {
		return input, fmt.Errorf("回复材料不足：目前只读到 %d 条有效回复，暂时无法分析争论焦点", len(input.References))
	}
	return input, nil
}
