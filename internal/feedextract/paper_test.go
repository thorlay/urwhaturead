package feedextract

import "testing"

func TestPaperIDsValidateHostAndDeduplicateVersions(t *testing.T) {
	for _, raw := range []string{"https://arxiv.org/abs/2611.12345v3", "https://arxiv.org/pdf/2611.12345.pdf", "https://huggingface.co/papers/2611.12345"} {
		id, ok := ArxivID(raw)
		if !ok || id != "2611.12345" {
			t.Fatalf("%s: %s %t", raw, id, ok)
		}
	}
	for _, raw := range []string{"file://arxiv.org/abs/2611.12345", "https://arxiv.org.evil.com/abs/2611.12345", "https://arxiv.org/abs/../../secret", "https://huggingface.co/api/papers/2611.12345"} {
		if _, ok := ArxivID(raw); ok {
			t.Fatalf("invalid paper URL: %s", raw)
		}
	}
}
