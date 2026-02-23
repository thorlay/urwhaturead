package clustering

import "testing"

func TestCanonicalizeLink(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "drop tracking params and fragment",
			input: "https://Example.com/path/to/story/?utm_source=x&b=2&a=1#section",
			want:  "https://example.com/path/to/story?a=1&b=2",
		},
		{
			name:  "normalize default https port",
			input: "https://example.com:443/path/",
			want:  "https://example.com/path",
		},
		{
			name:  "keep non-http scheme untouched",
			input: "mailto:test@example.com",
			want:  "mailto:test@example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanonicalizeLink(tt.input)
			if got != tt.want {
				t.Fatalf("CanonicalizeLink(%q)=%q want=%q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeTitle(t *testing.T) {
	got := NormalizeTitle("  AI is DESTROYING Open-Source!!!   ")
	want := "ai is destroying open source"
	if got != want {
		t.Fatalf("NormalizeTitle mismatch got=%q want=%q", got, want)
	}
}
