package worker

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"
)

func TestLobstersReplySampleKeepsTimedPublicReplies(t *testing.T) {
	now := time.Unix(1800000000, 0)
	comment := func(id string, at time.Time, text string) string {
		return fmt.Sprintf(`<div class="comment" id="%s"><div class="voters"><a class="upvoter">7</a></div>
			<div class="details"><div class="byline"><a href="/~reader">reader</a><time data-at-unix="%d"></time></div>
			<div class="comment_text"><p>%s</p></div></div></div>`, id, at.Unix(), text)
	}
	body := `<li class="story" data-shortid="abc123"><div class="story_text">Opening question</div></li>` +
		comment("c_abc001", now.Add(-time.Hour), "Recent viewpoint") +
		comment("c_abc001", now.Add(-time.Hour), "Duplicate") +
		comment("c_abc002", now.Add(-25*time.Hour), "Older response") +
		comment("c_abc003", now.Add(time.Minute), "Invalid future response")
	main, replies, err := parseLobstersReplies([]byte(body), "https://lobste.rs/s/abc123", now)
	if err != nil || main != "Opening question" || len(replies) != 1 {
		t.Fatalf("main=%q replies=%+v err=%v", main, replies, err)
	}
	if r := replies[0]; r.Link != "https://lobste.rs/s/abc123#c_abc001" || r.Content != "Recent viewpoint" || r.Author != "reader" || r.Upvotes == nil || *r.Upvotes != 7 {
		t.Fatalf("unexpected reply: %+v", r)
	}
}

func TestBogleheadsGroupsExactSubjectsAndExcludesQuotedText(t *testing.T) {
	now := time.Now().UTC()
	timestamp := now.Add(-time.Hour)
	entry := func(title, id string) *gofeed.Item {
		return &gofeed.Item{
			Title:           "Investing - Theory, News &amp; General • " + title,
			Link:            "https://www.bogleheads.org/forum/viewtopic.php?p=" + id + "#p" + id,
			PublishedParsed: &timestamp,
			Content:         `<blockquote>Other person's words</blockquote>Current author<p>Statistics: Posted by Reader</p>`,
		}
	}
	rows := bogleheadsTopicBatches([]*gofeed.Item{entry("Re: Funds", "11"), entry("Funds", "10"), entry("Re: Funds?", "12")}, now)
	if len(rows) != 2 || rows["Funds"].Opening == nil || len(rows["Funds"].Replies) != 1 {
		t.Fatalf("invalid grouping: %+v", rows)
	}
	reply := rows["Funds"].Replies[0]
	if !strings.HasSuffix(reply.Link, "#p11") || reply.Content != "Current author" {
		t.Fatalf("invalid reply: %+v", reply)
	}
}
