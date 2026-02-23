package clustering

import (
	"strings"
	"testing"

	"quick/internal/models"
)

func withVectorOptionsForTest(t *testing.T, options VectorOptions) {
	t.Helper()
	previous := currentVectorOptions()
	ConfigureVector(options)
	t.Cleanup(func() {
		ConfigureVector(previous)
	})
}

func TestBuildArticleEmbeddingDeterministic(t *testing.T) {
	withVectorOptionsForTest(t, VectorOptions{
		Enabled:     true,
		MaxDistance: 0.2,
		MinTokens:   3,
		IVFFlatList: 100,
	})

	summary := "Dependabot creates too many security alerts in Go projects."
	article := &models.Article{
		Title:           "AI is destroying open source",
		NormalizedTitle: "ai is destroying open source",
		CanonicalLink:   "https://example.com/blog/ai-open-source",
		Summary:         &summary,
	}

	vec1 := buildArticleEmbedding(article)
	vec2 := buildArticleEmbedding(article)
	if len(vec1) != embeddingDims {
		t.Fatalf("embedding dims got=%d want=%d", len(vec1), embeddingDims)
	}
	if len(vec2) != embeddingDims {
		t.Fatalf("embedding dims got=%d want=%d", len(vec2), embeddingDims)
	}
	for i := range vec1 {
		if vec1[i] != vec2[i] {
			t.Fatalf("embedding mismatch at %d", i)
		}
	}
}

func TestBuildArticleEmbeddingInsufficientTokens(t *testing.T) {
	withVectorOptionsForTest(t, VectorOptions{
		Enabled:     true,
		MaxDistance: 0.2,
		MinTokens:   3,
		IVFFlatList: 100,
	})

	article := &models.Article{
		Title:           "hi",
		NormalizedTitle: "hi",
	}
	vec := buildArticleEmbedding(article)
	if len(vec) != 0 {
		t.Fatalf("expected empty embedding, got dims=%d", len(vec))
	}
}

func TestConfigureVectorNormalizeDefaults(t *testing.T) {
	withVectorOptionsForTest(t, VectorOptions{
		Enabled:     true,
		MaxDistance: -1,
		MinTokens:   0,
		IVFFlatList: 0,
	})
	current := currentVectorOptions()
	if current.MaxDistance != defaultVectorMaxDistance {
		t.Fatalf("max distance = %v, expect %v", current.MaxDistance, defaultVectorMaxDistance)
	}
	if current.MinTokens != defaultVectorMinTokens {
		t.Fatalf("min tokens = %d, expect %d", current.MinTokens, defaultVectorMinTokens)
	}
	if current.IVFFlatList != defaultVectorIVFFlatList {
		t.Fatalf("ivfflat lists = %d, expect %d", current.IVFFlatList, defaultVectorIVFFlatList)
	}
}

func TestBuildArticleEmbeddingDisabledStillBuilds(t *testing.T) {
	withVectorOptionsForTest(t, VectorOptions{
		Enabled:     false,
		MaxDistance: 0.2,
		MinTokens:   1,
		IVFFlatList: 100,
	})
	article := &models.Article{
		Title:           "hello world",
		NormalizedTitle: "hello world",
	}
	vec := buildArticleEmbedding(article)
	if len(vec) != embeddingDims {
		t.Fatalf("embedding dims got=%d want=%d", len(vec), embeddingDims)
	}
}

func TestVectorLiteral(t *testing.T) {
	vec := make([]float32, embeddingDims)
	for i := range vec {
		vec[i] = 0.5
	}
	literal := vectorLiteral(vec)
	if !strings.HasPrefix(literal, "[") || !strings.HasSuffix(literal, "]") {
		t.Fatalf("vector literal format invalid: %s", literal)
	}
}

func TestIsVectorUnavailableError(t *testing.T) {
	err := isVectorUnavailableError(assertErr(`ERROR: extension "vector" is not available`))
	if !err {
		t.Fatalf("expected unavailable error detection")
	}
}

type fakeErr string

func (e fakeErr) Error() string { return string(e) }

func assertErr(msg string) error {
	return fakeErr(msg)
}
