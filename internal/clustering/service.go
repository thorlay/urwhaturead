package clustering

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"quick/internal/models"

	"gorm.io/gorm"
)

var titleNormalizeRe = regexp.MustCompile(`[^\p{L}\p{N}]+`)

const matchWindow = 72 * time.Hour

func CanonicalizeLink(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "http" && scheme != "https" {
		return strings.TrimSpace(raw)
	}

	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	if strings.HasSuffix(parsed.Host, ":80") && scheme == "http" {
		parsed.Host = strings.TrimSuffix(parsed.Host, ":80")
	}
	if strings.HasSuffix(parsed.Host, ":443") && scheme == "https" {
		parsed.Host = strings.TrimSuffix(parsed.Host, ":443")
	}

	query := parsed.Query()
	for key := range query {
		lowerKey := strings.ToLower(strings.TrimSpace(key))
		if strings.HasPrefix(lowerKey, "utm_") ||
			lowerKey == "fbclid" ||
			lowerKey == "gclid" ||
			lowerKey == "mc_cid" ||
			lowerKey == "mc_eid" ||
			lowerKey == "ref" ||
			lowerKey == "ref_src" {
			query.Del(key)
		}
	}
	if len(query) > 0 {
		keys := make([]string, 0, len(query))
		for key := range query {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		normalized := url.Values{}
		for _, key := range keys {
			values := query[key]
			sort.Strings(values)
			for _, value := range values {
				normalized.Add(key, value)
			}
		}
		parsed.RawQuery = normalized.Encode()
	} else {
		parsed.RawQuery = ""
	}
	parsed.Fragment = ""
	parsed.Path = strings.TrimSpace(parsed.EscapedPath())
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	if len(parsed.Path) > 1 && strings.HasSuffix(parsed.Path, "/") {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}

	return parsed.String()
}

func NormalizeTitle(raw string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return ""
	}
	normalized = titleNormalizeRe.ReplaceAllString(normalized, " ")
	normalized = strings.Join(strings.Fields(normalized), " ")
	return normalized
}

func EnsureArticleNormalization(article *models.Article) {
	if article == nil {
		return
	}
	if strings.TrimSpace(article.CanonicalLink) == "" {
		article.CanonicalLink = CanonicalizeLink(article.Link)
	}
	if strings.TrimSpace(article.NormalizedTitle) == "" {
		article.NormalizedTitle = NormalizeTitle(article.Title)
	}
}

func AssignArticleToCluster(tx *gorm.DB, article *models.Article) error {
	if tx == nil || article == nil || article.ID == 0 {
		return nil
	}
	EnsureArticleNormalization(article)
	embedding := buildArticleEmbedding(article)

	refTime := articleReferenceTime(article)
	windowFrom := refTime.Add(-matchWindow)
	windowTo := refTime.Add(matchWindow)

	clusterID, err := findExistingClusterID(tx, article.CanonicalLink, article.NormalizedTitle, windowFrom, windowTo)
	if err != nil {
		return err
	}
	if clusterID == 0 {
		clusterID, err = findExistingClusterIDByVector(tx, article.ID, embedding, windowFrom, windowTo)
		if err != nil {
			return err
		}
	}

	if clusterID == 0 {
		cluster := models.EventCluster{
			CanonicalLink:           article.CanonicalLink,
			NormalizedTitle:         article.NormalizedTitle,
			RepresentativeArticleID: article.ID,
			ArticleCount:            1,
			FirstPublishedAt:        &refTime,
			LastPublishedAt:         &refTime,
		}
		if err := tx.Create(&cluster).Error; err != nil {
			return err
		}
		clusterID = cluster.ID
	} else {
		if err := tx.Model(&models.EventCluster{}).
			Where("id = ?", clusterID).
			Updates(map[string]any{
				"article_count": gorm.Expr("article_count + 1"),
				"first_published_at": gorm.Expr(
					"CASE WHEN first_published_at IS NULL OR first_published_at > ? THEN ? ELSE first_published_at END",
					refTime, refTime,
				),
				"last_published_at": gorm.Expr(
					"CASE WHEN last_published_at IS NULL OR last_published_at < ? THEN ? ELSE last_published_at END",
					refTime, refTime,
				),
				"representative_article_id": gorm.Expr(
					"CASE WHEN last_published_at IS NULL OR last_published_at < ? THEN ? ELSE representative_article_id END",
					refTime, article.ID,
				),
			}).Error; err != nil {
			return err
		}
	}

	if err := tx.Model(&models.Article{}).
		Where("id = ?", article.ID).
		Updates(map[string]any{
			"cluster_id":       clusterID,
			"canonical_link":   article.CanonicalLink,
			"normalized_title": article.NormalizedTitle,
		}).Error; err != nil {
		return err
	}
	if err := EnsureArticleVector(tx, article); err != nil {
		return err
	}
	article.ClusterID = &clusterID
	return nil
}

func findExistingClusterID(
	tx *gorm.DB,
	canonicalLink string,
	normalizedTitle string,
	windowFrom time.Time,
	windowTo time.Time,
) (uint64, error) {
	var row struct {
		ClusterID uint64 `gorm:"column:cluster_id"`
	}

	if canonicalLink != "" {
		err := tx.Table("articles").
			Select("cluster_id").
			Where("cluster_id IS NOT NULL AND canonical_link = ?", canonicalLink).
			Where("COALESCE(published_at, created_at) BETWEEN ? AND ?", windowFrom, windowTo).
			Order("COALESCE(published_at, created_at) DESC, id DESC").
			Limit(1).
			Scan(&row).Error
		if err != nil {
			return 0, err
		}
		if row.ClusterID > 0 {
			return row.ClusterID, nil
		}
	}

	if normalizedTitle != "" {
		err := tx.Table("articles").
			Select("cluster_id").
			Where("cluster_id IS NOT NULL AND normalized_title = ?", normalizedTitle).
			Where("COALESCE(published_at, created_at) BETWEEN ? AND ?", windowFrom, windowTo).
			Order("COALESCE(published_at, created_at) DESC, id DESC").
			Limit(1).
			Scan(&row).Error
		if err != nil {
			return 0, err
		}
		if row.ClusterID > 0 {
			return row.ClusterID, nil
		}
	}

	return 0, nil
}

func articleReferenceTime(article *models.Article) time.Time {
	if article == nil {
		return time.Now().UTC()
	}
	if article.PublishedAt != nil && !article.PublishedAt.IsZero() {
		return article.PublishedAt.UTC()
	}
	if !article.CreatedAt.IsZero() {
		return article.CreatedAt.UTC()
	}
	return time.Now().UTC()
}
