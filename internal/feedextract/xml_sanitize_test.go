package feedextract

import "testing"

func TestSanitizeXML10_RemovesIllegalControlCharacters(t *testing.T) {
	input := []byte("<rss><channel><title>a\x01b</title></channel></rss>")
	got := string(SanitizeXML10(input))
	want := "<rss><channel><title>ab</title></channel></rss>"
	if got != want {
		t.Fatalf("SanitizeXML10()=%q, want %q", got, want)
	}
}

func TestSanitizeXML10_PreservesAllowedWhitespace(t *testing.T) {
	input := []byte("<title>a\tb\nc\rd</title>")
	got := string(SanitizeXML10(input))
	want := "<title>a\tb\nc\rd</title>"
	if got != want {
		t.Fatalf("SanitizeXML10()=%q, want %q", got, want)
	}
}

func TestSanitizeXML10_RemovesIllegalNumericCharacterReferences(t *testing.T) {
	input := []byte("<title>a&#x1;b&#1;c&#x0B;d</title>")
	got := string(SanitizeXML10(input))
	want := "<title>abcd</title>"
	if got != want {
		t.Fatalf("SanitizeXML10()=%q, want %q", got, want)
	}
}

func TestSanitizeXML10_PreservesValidNumericCharacterReferences(t *testing.T) {
	input := []byte("<title>a&#x9;b&#10;c&#32;d</title>")
	got := string(SanitizeXML10(input))
	want := "<title>a&#x9;b&#10;c&#32;d</title>"
	if got != want {
		t.Fatalf("SanitizeXML10()=%q, want %q", got, want)
	}
}
