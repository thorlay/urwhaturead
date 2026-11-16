package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDiscussionSamplingPreservesDissentAndBoundsScope(t *testing.T) {
	comments := []articleThreadComment{}
	for i := 0; i < 40; i++ {
		at := time.Date(2026, 11, 16, 1, i, 0, 0, time.UTC)
		votes := i
		comments = append(comments, articleThreadComment{Author: fmt.Sprintf("user-%d", i), Link: fmt.Sprintf("https://v2ex.com/t/123#reply%d", i+1), Content: fmt.Sprintf("reply %d", i), Upvotes: &votes, PublishedAt: &at})
	}
	comments[0].Content = "低赞反对意见"
	comments = append(comments, articleThreadComment{Link: "https://evil.com/t/123#reply1", Content: "must be excluded"}, comments[0])
	total := 500
	refs, sample := selectDiscussionReplies("https://v2ex.com/t/123", comments, &total, "RSS snapshot")
	if len(refs) != 16 || sample.Available != 40 || sample.Analyzed != 16 || !sample.Partial || *sample.ReportedTotal != 500 {
		t.Fatalf("wrong sample: %+v", sample)
	}
	combined := ""
	for _, r := range refs {
		combined += r.Content
	}
	if !strings.Contains(combined, "低赞反对意见") || !strings.Contains(combined, "reply 39") {
		t.Fatal("must retain low-vote early dissent and high-vote late replies")
	}
	if sample.FirstAt == nil || sample.LastAt == nil || sample.DatedReplies != 16 {
		t.Fatal("must expose sampled time range")
	}
	input := discussionInput{ArticleID: 1, Title: "Thread", References: refs, Sample: sample}
	prompt := buildDiscussionPrompt(input, 12000)
	if len(prompt) > 12000 || !strings.Contains(prompt, "[R16]") {
		t.Fatal("prompt must fit budget without dropping reference IDs")
	}
	before := discussionInputHash(input)
	input.Sample.ReadAt = time.Now().Add(time.Hour)
	if discussionInputHash(input) != before {
		t.Fatal("identical reply snapshots must dedupe despite read time")
	}
	input.References[0].Content += " edit"
	if discussionInputHash(input) == before {
		t.Fatal("reply edits must invalidate the sample identity")
	}
}

func TestDiscussionClaimsOnlyLinkProvidedReplyEvidence(t *testing.T) {
	input := discussionInput{References: []discussionReference{{ID: "R01", Link: "https://v2ex.com/t/123#reply1"}, {ID: "R02", Link: "https://v2ex.com/t/123#reply2"}}}
	raw := `{"assessment":"样本显示存在分歧","focus":[{"point":"在争事实 [假链接](https://evil.com)","evidence":["R01","R99"]}],"perspectives":[{"point":"支持者有条件支持","evidence":["R02"]},{"point":"不能捏造没有依据的观点","evidence":["R99"]}],"causes":[{"point":"适用条件不同","inference":true,"evidence":["R01","R02"]}],"limits":"样本不足以判断整体比例"}`
	summary, err := renderDiscussionJudgment(raw, input)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(summary, "evil.com") || strings.Contains(summary, "捏造没有依据") || strings.Contains(summary, "R99") {
		t.Fatal("must not publish invented evidence links", summary)
	}
	for _, want := range []string{"争论焦点", "各方观点与理由", "冲突原因", "可能原因（推测）", "不代表全部参与者", "https://v2ex.com/t/123#reply1"} {
		if !strings.Contains(summary, want) {
			t.Fatal("missing", want)
		}
	}
	if _, err := renderDiscussionJudgment(`{"assessment":"激烈","focus":[{"point":"claims","evidence":["R99"]}]}`, input); err == nil {
		t.Fatal("do not save unsupported analyses")
	}
}

func TestDiscussionLinksStayWithinTheOriginalThread(t *testing.T) {
	for _, tc := range []struct {
		topic, reply string
		want         bool
	}{
		{"https://nga.178.com/read.php?tid=123", "https://bbs.nga.cn/read.php?tid=123#postcontent456", true},
		{"https://nga.178.com/read.php?tid=123", "https://nga.178.com/read.php?tid=999#postcontent456", false},
		{"https://www.uscardforum.com/t/topic/123", "https://www.uscardforum.com/t/topic/123/4", true},
		{"https://v2ex.com/t/123", "javascript:alert(1)", false},
		{"https://v2ex.com/t/123", "https://v2ex.com.evil.com/t/123#reply1", false},
	} {
		if got := sameDiscussion(tc.topic, tc.reply); got != tc.want {
			t.Fatalf("%+v -> %t", tc, got)
		}
	}
}

func TestHNDiscussionRetrievesNestedRepliesAndSkipsDeletedOrForeignParents(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data := map[string]any{}
		switch r.URL.Path {
		case "/1.json":
			data = map[string]any{"id": 1, "kids": []int{2, 3, 4}, "descendants": 90, "text": "topic"}
		case "/2.json":
			data = map[string]any{"id": 2, "parent": 1, "by": "alice", "text": "main reply", "kids": []int{5}, "time": 1000}
		case "/3.json":
			data = map[string]any{"id": 3, "parent": 1, "deleted": true}
		case "/4.json":
			data = map[string]any{"id": 4, "parent": 999, "text": "another thread"}
		case "/5.json":
			data = map[string]any{"id": 5, "parent": 2, "by": "bob", "text": "counterargument", "time": 1100}
		}
		json.NewEncoder(w).Encode(data)
	}))
	defer server.Close()
	comments, total, main, err := fetchHNDiscussionFrom(context.Background(), "1", server.URL+"/", server.Client())
	if err != nil || len(comments) != 2 || total == nil || *total != 90 || main != "topic" {
		t.Fatalf("%+v %v %s %v", comments, total, main, err)
	}
	if !strings.Contains(comments[1].Link, "id=5") || comments[1].Content != "counterargument" {
		t.Fatal("nested dissent must remain visible")
	}
}

func TestDiscussionAnalysisCanExplainThatNoClearConflictWasFound(t *testing.T) {
	input := discussionInput{References: []discussionReference{{ID: "R01", Link: "https://v2ex.com/t/123#reply1"}, {ID: "R02", Link: "https://v2ex.com/t/123#reply2"}}}
	summary, err := renderDiscussionJudgment(`{"assessment":"两条样本都在补充操作经验，尚未看到明显争吵","assessment_evidence":["R01","R02"],"focus":[],"perspectives":[],"causes":[],"limits":"无法据此判断整个帖子是否激烈"}`, input)
	if err != nil || !strings.Contains(summary, "尚未看到明显争吵") {
		t.Fatalf("must not invent a conflict: %s %v", summary, err)
	}
}
