package textclean

import (
	"strings"
	"testing"
)

func BenchmarkNormalizeInline(b *testing.B) {
	for _, tc := range []struct {
		name, text string
	}{
		{"title", "V2EX 热门主题：今天聊 NAS 和家庭网络"},
		{"summary", strings.Repeat("这是一段文章摘要，包含中文、English 和数字 2026。", 12)},
		{"whitespace", strings.Repeat("文章内容\t包含\n多个   空白字符。", 12)},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				NormalizeInline(tc.text)
			}
		})
	}
}
