package sourceclassify

import "testing"

func TestResolveTagWithRecentText(t *testing.T) {
	tag, reason := ResolveTagWithRecentText(
		"general",
		"https://example.com/feed.xml",
		nil,
		[]string{
			"美股市场继续上涨，投资者关注美联储利率路径和银行财报",
			"债券收益率回落，基金经理重新评估科技股估值",
		},
	)
	if tag != "finance" {
		t.Fatalf("tag=%q, want finance", tag)
	}
	if reason != "recent_articles" {
		t.Fatalf("reason=%q, want recent_articles", reason)
	}
}

func TestInferTagByRecentTextDoesNotMatchShortASCIIInsideWords(t *testing.T) {
	got := InferTagByRecentText([]string{
		"daily paid email campaign update",
		"plain status note without technology terms",
	})
	if got != "" {
		t.Fatalf("InferTagByRecentText()=%q, want empty", got)
	}
}

func TestResolveTagUsesRSSHubPathRule(t *testing.T) {
	tag, reason := ResolveTagWithReason("general", "http://127.0.0.1:1200/v2ex/topics/hot", nil)
	if tag != "tech" {
		t.Fatalf("tag=%q, want tech", tag)
	}
	if reason != "rule" {
		t.Fatalf("reason=%q, want rule", reason)
	}
}

func TestApplyTagBulkAction(t *testing.T) {
	got := ApplyTagBulkAction([]string{"tech", "forum"}, []string{"finance", "tech"}, "add")
	want := []string{"tech", "forum", "finance"}
	if !EqualTags(got, want) {
		t.Fatalf("ApplyTagBulkAction()=%v, want %v", got, want)
	}
}
