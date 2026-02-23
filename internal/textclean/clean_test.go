package textclean

import "testing"

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
