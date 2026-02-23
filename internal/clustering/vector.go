package clustering

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"quick/internal/models"

	"gorm.io/gorm"
)

const (
	embeddingDims            = 256
	embeddingModel           = "hash256-v1"
	defaultVectorMaxDistance = 0.20
	defaultVectorMinTokens   = 3
	defaultVectorIVFFlatList = 100
)

var embeddingTokenRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

type VectorOptions struct {
	Enabled     bool
	MaxDistance float64
	MinTokens   int
	IVFFlatList int
}

var (
	vectorOptionsMu sync.RWMutex
	vectorOptions   = VectorOptions{
		Enabled:     true,
		MaxDistance: defaultVectorMaxDistance,
		MinTokens:   defaultVectorMinTokens,
		IVFFlatList: defaultVectorIVFFlatList,
	}
)

func ConfigureVector(options VectorOptions) {
	vectorOptionsMu.Lock()
	defer vectorOptionsMu.Unlock()

	vectorOptions = VectorOptions{
		Enabled:     options.Enabled,
		MaxDistance: normalizeVectorMaxDistance(options.MaxDistance),
		MinTokens:   normalizeVectorMinTokens(options.MinTokens),
		IVFFlatList: normalizeIVFFlatList(options.IVFFlatList),
	}
}

func currentVectorOptions() VectorOptions {
	vectorOptionsMu.RLock()
	defer vectorOptionsMu.RUnlock()
	return vectorOptions
}

func GetVectorOptions() VectorOptions {
	return currentVectorOptions()
}

func EnsureVectorSchema(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	options := currentVectorOptions()
	if !options.Enabled {
		return nil
	}
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS vector`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS article_vectors (
			article_id BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
			model TEXT NOT NULL DEFAULT 'hash256-v1',
			embedding VECTOR(256) NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS ix_article_vectors_created_at ON article_vectors(created_at DESC)`).Error; err != nil {
		return err
	}
	if err := db.Exec(fmt.Sprintf(`
		CREATE INDEX IF NOT EXISTS ix_article_vectors_embedding_ivfflat
		ON article_vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = %d)
	`, options.IVFFlatList)).Error; err != nil {
		return err
	}
	return nil
}

func findExistingClusterIDByVector(
	tx *gorm.DB,
	articleID uint64,
	embedding []float32,
	windowFrom time.Time,
	windowTo time.Time,
) (uint64, error) {
	options := currentVectorOptions()
	if tx == nil || articleID == 0 || len(embedding) == 0 || !options.Enabled {
		return 0, nil
	}

	literal := vectorLiteral(embedding)
	var row struct {
		ClusterID uint64  `gorm:"column:cluster_id"`
		Distance  float64 `gorm:"column:distance"`
	}
	err := tx.Table("article_vectors av").
		Select("a.cluster_id AS cluster_id, (av.embedding <=> ?::vector) AS distance", literal).
		Joins("JOIN articles a ON a.id = av.article_id").
		Where("a.cluster_id IS NOT NULL").
		Where("a.id <> ?", articleID).
		Where("COALESCE(a.published_at, a.created_at) BETWEEN ? AND ?", windowFrom, windowTo).
		Order("distance ASC").
		Order("COALESCE(a.published_at, a.created_at) DESC").
		Order("a.id DESC").
		Limit(1).
		Scan(&row).Error
	if err != nil {
		if isVectorUnavailableError(err) {
			return 0, nil
		}
		return 0, err
	}
	if row.ClusterID == 0 || row.Distance > options.MaxDistance {
		return 0, nil
	}
	return row.ClusterID, nil
}

func upsertArticleVector(tx *gorm.DB, articleID uint64, embedding []float32) error {
	options := currentVectorOptions()
	if tx == nil || articleID == 0 || len(embedding) == 0 || !options.Enabled {
		return nil
	}
	literal := vectorLiteral(embedding)
	err := tx.Exec(`
		INSERT INTO article_vectors (article_id, model, embedding, created_at, updated_at)
		VALUES (?, ?, ?::vector, NOW(), NOW())
		ON CONFLICT (article_id)
		DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding, updated_at = NOW()
	`, articleID, embeddingModel, literal).Error
	if err != nil && isVectorUnavailableError(err) {
		return nil
	}
	return err
}

func EnsureArticleVector(tx *gorm.DB, article *models.Article) error {
	if tx == nil || article == nil || article.ID == 0 {
		return nil
	}
	return upsertArticleVector(tx, article.ID, buildArticleEmbedding(article))
}

func buildArticleEmbedding(article *models.Article) []float32 {
	if article == nil {
		return nil
	}

	parts := make([]string, 0, 5)
	if title := strings.TrimSpace(article.Title); title != "" {
		parts = append(parts, title)
	}
	if normalized := strings.TrimSpace(article.NormalizedTitle); normalized != "" {
		parts = append(parts, normalized)
	}
	if link := strings.TrimSpace(article.CanonicalLink); link != "" {
		parts = append(parts, link)
	}
	if article.Summary != nil {
		if v := strings.TrimSpace(*article.Summary); v != "" {
			parts = append(parts, trimRunes(v, 240))
		}
	}
	if article.Content != nil {
		if v := strings.TrimSpace(*article.Content); v != "" {
			parts = append(parts, trimRunes(v, 400))
		}
	}

	text := strings.ToLower(strings.Join(parts, " "))
	tokens := embeddingTokenRe.FindAllString(text, -1)
	if len(tokens) < currentVectorOptions().MinTokens {
		return nil
	}

	vec := make([]float32, embeddingDims)
	for _, token := range tokens {
		hash := fnv1a64(token)
		idx := int(hash % embeddingDims)
		sign := float32(1)
		if hash&1 == 1 {
			sign = -1
		}
		vec[idx] += sign
	}
	norm := float32(0)
	for _, value := range vec {
		norm += value * value
	}
	if norm == 0 {
		return nil
	}
	norm = float32(math.Sqrt(float64(norm)))
	for i := range vec {
		vec[i] /= norm
	}
	return vec
}

func vectorLiteral(vec []float32) string {
	if len(vec) == 0 {
		return "[]"
	}
	parts := make([]string, len(vec))
	for i, value := range vec {
		parts[i] = strconv.FormatFloat(float64(value), 'f', 6, 32)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func isVectorUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, `extension "vector" is not available`) ||
		strings.Contains(message, `type "vector" does not exist`) ||
		strings.Contains(message, `relation "article_vectors" does not exist`) ||
		strings.Contains(message, `operator does not exist: vector`) ||
		strings.Contains(message, "could not open extension control file")
}

func IsVectorUnavailableError(err error) bool {
	return isVectorUnavailableError(err)
}

func trimRunes(raw string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(raw)
	if len(runes) <= max {
		return raw
	}
	return string(runes[:max])
}

func fnv1a64(raw string) uint64 {
	var (
		offset uint64 = 1469598103934665603
		prime  uint64 = 1099511628211
	)
	hash := offset
	for i := 0; i < len(raw); i++ {
		hash ^= uint64(raw[i])
		hash *= prime
	}
	return hash
}

func normalizeVectorMaxDistance(value float64) float64 {
	if value <= 0 || value > 2 {
		return defaultVectorMaxDistance
	}
	return value
}

func normalizeVectorMinTokens(value int) int {
	if value < 1 {
		return defaultVectorMinTokens
	}
	return value
}

func normalizeIVFFlatList(value int) int {
	if value < 1 {
		return defaultVectorIVFFlatList
	}
	return value
}
