package handlers

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestForumBriefingUsesDiscussionEvidenceAndCitations(t *testing.T) {
	content := "楼主：工具很好用。\n回复 Alice：省了两小时。\n回复 Bob：隐私成本太高。"
	rows := []feedItem{{ID: 1, SourceTag: "forum", SourceName: "V2EX", Title: "工具体验", Link: "https://v2ex.com/t/123", Content: &content}}
	prompt := buildFeedBriefingPrompt(rows)
	for _, want := range []string{"论坛讨论简报", "大家在聊什么", "主要观点", "共识与分歧", "回复材料不足", "[A01]", "隐私成本太高", rows[0].Link} {
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
