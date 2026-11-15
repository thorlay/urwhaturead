package handlers

import (
	"context"
	"encoding/json"
	"quick/internal/models"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestForumBriefingUsesDiscussionEvidenceAndCitations(t *testing.T) {
	content := "楼主：工具很好用。\n回复 Alice：省了两小时。\n回复 Bob：隐私成本太高。"
	rows := []feedItem{{ID: 1, SourceTag: "forum", SourceName: "V2EX", Title: "工具体验", Link: "https://v2ex.com/t/123", Content: &content}}
	prompt := buildFeedBriefingPrompt(rows)
	for _, want := range []string{"论坛讨论简报", "大家在聊什么", "主要观点", "共识与分歧", "讨论倾向（样本）", "不同意见", "不因赞数低而省略", "没有连续观测数据", "回复材料不足", "[A01]", "隐私成本太高", rows[0].Link} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing %q in forum prompt", want)
		}
	}
	rows = append(rows, feedItem{SourceTag: "tech", Link: "https://example.com/news"})
	if isForumBriefing(rows) {
		t.Fatal("mixed reading flow must keep the general briefing")
	}
}

func TestForumPromptBudgetPreservesEveryThreadAndLateReplies(t *testing.T) {
	content := "开头观点" + strings.Repeat("讨论细节", 1000) + "末尾反对观点"
	rows := make([]feedItem, 6)
	for i := range rows {
		rows[i] = feedItem{ID: uint64(i + 1), SourceTag: "forum", Title: "讨论", Content: &content}
	}
	prompt := buildForumBriefingPromptWithBudget(rows, 12000)
	if len(prompt) > 12000 || !utf8.ValidString(prompt) {
		t.Fatalf("prompt has invalid UTF-8 or exceeds budget: %d bytes", len(prompt))
	}
	if !strings.Contains(prompt, "[A06]") || strings.Count(prompt, "末尾反对观点") != 6 {
		t.Fatal("budget must preserve later threads and later replies")
	}
}

func TestForumBriefingCacheChangesWithReplies(t *testing.T) {
	content := "第一条回复"
	rows := []feedItem{{ID: 1, SourceTag: "forum", Content: &content}}
	before, _ := buildFeedBriefingDigest(20, "forum", "", "test", nil, rows)
	content = "第一条回复；新增不同意见"
	after, _ := buildFeedBriefingDigest(20, "forum", "", "test", nil, rows)
	if before == after {
		t.Fatal("reply changes must invalidate cached discussion reports")
	}
}

func TestForumEvidenceRetainsLowVoteDissent(t *testing.T) {
	high, low := 100, 0
	thread := articleThread{Comments: []articleThreadComment{{Author: "popular", Content: "主流理由", Upvotes: &high}, {Author: "minority", Content: "不同意见及反例", Upvotes: &low}, {Author: "other", Content: "条件不同"}}}
	raw, _ := json.Marshal(thread)
	row := feedItem{Link: "https://nga.178.com/read.php?tid=123"}
	h := &FeedHandler{}
	h.enrichForumBriefingEvidence(context.Background(), &row, models.ArticleEnrichment{Thread: raw})
	if row.Content == nil || !strings.Contains(*row.Content, "不同意见及反例") || !strings.Contains(*row.Content, "赞数：0") || !strings.Contains(*row.Content, "非完整讨论") {
		t.Fatalf("missing dissent or sampling limits: %v", row.Content)
	}
}

func TestForumSelectionSkipsHeadlinesWithoutReplies(t *testing.T) {
	replies := "Alice: quick. Bob: too expensive."
	metadata := "Article URL: example.com # Comments: 700"
	rows := []feedItem{{ID: 1, Link: "https://news.ycombinator.com/item?id=1", Content: &metadata}, {ID: 2, Link: "https://news.ycombinator.com/item?id=2", Content: &replies}, {ID: 3, Link: "https://v2ex.com/t/3"}}
	got := forumEvidenceCandidates(rows)
	if len(got) != 2 || got[0].ID != 2 || got[1].ID != 3 {
		t.Fatalf("headlines must not displace reply evidence: %+v", got)
	}
	if len(forumEvidenceCandidates(rows[:1])) != 1 {
		t.Fatal("keep insufficient-evidence explanation when nothing else exists")
	}
}
