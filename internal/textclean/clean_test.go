package textclean

import (
	"html"
	"regexp"
	"strings"
	"testing"
)

func TestNormalizeInline_RedditBoilerplate(t *testing.T) {
	input := "&#32; submitted by &#32; /u/gdelacalle [link] [comments]"
	got := NormalizeInline(input)
	if got != "" {
		t.Fatalf("NormalizeInline(%q)=%q, want empty", input, got)
	}
}

func TestNormalizeFromHTML_StripsTagsAndEntities(t *testing.T) {
	input := `<p>Hello&nbsp;world</p><p>submitted by /u/tester [link]</p>`
	got := NormalizeFromHTML(input)
	want := "Hello world"
	if got != want {
		t.Fatalf("NormalizeFromHTML(%q)=%q, want %q", input, got, want)
	}
}

func TestNormalizeInline_LeavesNormalText(t *testing.T) {
	input := "V2EX 热门主题：今天聊 NAS"
	got := NormalizeInline(input)
	if got != input {
		t.Fatalf("NormalizeInline(%q)=%q, want %q", input, got, input)
	}
}

func TestNormalizeFromHTMLBlock_PreservesBreaks(t *testing.T) {
	input := `<p>Hello&nbsp;world</p><p>Second paragraph</p><ul><li>item 1</li><li>item 2</li></ul>`
	got := NormalizeFromHTMLBlock(input)
	want := "Hello world\n\nSecond paragraph\n\n- item 1\n- item 2"
	if got != want {
		t.Fatalf("NormalizeFromHTMLBlock(%q)=%q, want %q", input, got, want)
	}
}

// Compare against the original regexp pipeline, including its ASCII whitespace
// semantics and feed boilerplate rules.
func FuzzNormalizeMatchesRegexp(f *testing.F) {
	for _, value := range []string{
		"", "普通标题 English 2026", "a  b\tc\nd\re\ff", "a\vb\u2003c\u00a0d",
		"<p>Hello&nbsp;world</p><p>submitted by /u/tester [link]</p>",
		"SUBMITTED BY /U/Test_User [ COMMENTS ]", "[link]\n\t[comments]",
		"a\xff\xfe b", "submitted by /u/a submitted by /u/b", "a < b > c",
	} {
		f.Add(value)
	}
	spaces := regexp.MustCompile(`\s+`)
	f.Fuzz(func(t *testing.T, raw string) {
		for _, stripHTML := range []bool{false, true} {
			want := strings.TrimSpace(raw)
			want = html.UnescapeString(want)
			want = strings.ReplaceAll(want, "\u00a0", " ")
			if stripHTML {
				want = htmlTagPattern.ReplaceAllString(want, " ")
			}
			want = redditSubmittedByExpr.ReplaceAllString(want, " ")
			want = redditMetaTokenExpr.ReplaceAllString(want, " ")
			want = strings.TrimSpace(spaces.ReplaceAllString(want, " "))
			if got := normalize(raw, stripHTML); got != want {
				t.Fatalf("normalize(%q, %t) = %q, want %q", raw, stripHTML, got, want)
			}
		}
	})
}
