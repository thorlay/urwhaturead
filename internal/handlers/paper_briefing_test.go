package handlers

import (
	"strings"
	"testing"
	"time"
)

func TestPaperEvidenceSeparatesResultsLimitsAndLinks(t *testing.T) {
	html := `<article><section class="ltx_section"><h2>2 Method</h2><p>Compare the retrieval mechanism.</p><a href="https://github.com/test-lab/method">Code</a></section><section class="ltx_section"><h2>3 Experiments</h2><p>Held-out dataset; baseline 10 and result 12.</p></section><section class="ltx_section"><h2>4 Limitations</h2><p>Only evaluated in English.</p></section></article>`
	content := paperHTMLContext([]byte(html), "An abstract", "2611.12345")
	for _, want := range []string{"Method", "baseline 10", "Only evaluated in English", "https://github.com/test-lab/method", "并非完整全文"} {
		if !strings.Contains(content, want) {
			t.Fatalf("missing evidence %s", want)
		}
	}
	rows := []feedItem{{SourceTag: "papers", Title: "A method", Link: "https://arxiv.org/abs/2611.12345", Content: &content}}
	prompt := buildFeedBriefingPrompt(rows)
	for _, want := range []string{"论文精选", "关键方法", "证据", "局限", "阅读依据", "不补造数字", "[A01]"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing prompt requirement %s", want)
		}
	}
	resources := appendPaperResourceLinks("report", rows)
	if !strings.Contains(resources, "https://github.com/test-lab/method") || !strings.Contains(resources, "正文部分章节") {
		t.Fatal(resources)
	}
}
func TestPaperPromptPreservesReferencesAndCodeWithinBudget(t *testing.T) {
	content := "[论文正文节选]" + strings.Repeat("方法证据", 2000) + "\n代码 https://github.com/lab/repo"
	rows := []feedItem{}
	for i := 0; i < 4; i++ {
		rows = append(rows, feedItem{SourceTag: "papers", Content: &content, Link: "https://arxiv.org/abs/2611.12345"})
	}
	prompt := buildPaperBriefingPrompt(rows, 12000)
	if len(prompt) > 12000 || !strings.Contains(prompt, "[A04]") || strings.Count(prompt, "文中代码链接（归属以原文为准）") != 4 {
		t.Fatalf("invalid prompt budget/references: %d", len(prompt))
	}
}
func TestPaperDailyIdentityFollowsLosAngelesDay(t *testing.T) {
	t.Setenv("PAPER_BRIEFING_TIMEZONE", "America/Los_Angeles")
	t.Setenv("PAPER_BRIEFING_DAILY_TIME", "08:00")
	now := time.Date(2026, 11, 15, 16, 0, 0, 0, time.UTC)
	if dailyPaperDigest(now) != dailyPaperDigest(now.Add(time.Hour)) || dailyPaperDigest(now) == dailyPaperDigest(now.Add(24*time.Hour)) {
		t.Fatal("daily digest must be stable within one local day")
	}
	loc, minute := paperSchedule()
	if loc.String() != "America/Los_Angeles" || minute != 480 {
		t.Fatal("invalid morning schedule")
	}
}
