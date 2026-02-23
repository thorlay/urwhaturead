package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"quick/internal/clustering"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type diagnosisArticleRow struct {
	ID              uint64
	ClusterID       *uint64
	CanonicalLink   string
	NormalizedTitle string
}

type diagnosisPeerRow struct {
	ID              uint64
	CanonicalLink   string
	NormalizedTitle string
}

type clusterDiagnosisPayload struct {
	ArticleID         uint64   `json:"article_id"`
	ClusterID         *uint64  `json:"cluster_id,omitempty"`
	ClusterSize       int64    `json:"cluster_size"`
	MatchBasis        string   `json:"match_basis"`
	MatchArticleID    *uint64  `json:"match_article_id,omitempty"`
	VectorDistance    *float64 `json:"vector_distance,omitempty"`
	VectorMaxDistance float64  `json:"vector_max_distance"`
	VectorEnabled     bool     `json:"vector_enabled"`
	Inferred          bool     `json:"inferred"`
}

func (h *ArticleHandler) GetClusterDiagnosis(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	payload, err := h.loadClusterDiagnosis(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			notFound(c, "article not found")
			return
		}
		internalServerError(c, "query cluster diagnosis failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": payload,
	})
}

func (h *ArticleHandler) loadClusterDiagnosis(ctx context.Context, articleID uint64) (clusterDiagnosisPayload, error) {
	var target diagnosisArticleRow
	if err := h.db.WithContext(ctx).
		Table("articles").
		Select("id, cluster_id, canonical_link, normalized_title").
		Where("id = ?", articleID).
		Take(&target).Error; err != nil {
		return clusterDiagnosisPayload{}, err
	}

	options := clustering.GetVectorOptions()
	payload := clusterDiagnosisPayload{
		ArticleID:         target.ID,
		ClusterID:         target.ClusterID,
		ClusterSize:       1,
		MatchBasis:        "single",
		VectorMaxDistance: options.MaxDistance,
		VectorEnabled:     options.Enabled,
		Inferred:          true,
	}

	if target.ClusterID == nil {
		return payload, nil
	}

	var clusterSize int64
	if err := h.db.WithContext(ctx).
		Table("articles").
		Where("cluster_id = ?", *target.ClusterID).
		Count(&clusterSize).Error; err != nil {
		return clusterDiagnosisPayload{}, err
	}
	if clusterSize > 0 {
		payload.ClusterSize = clusterSize
	}
	if payload.ClusterSize <= 1 {
		return payload, nil
	}

	var peers []diagnosisPeerRow
	if err := h.db.WithContext(ctx).
		Table("articles").
		Select("id, canonical_link, normalized_title").
		Where("cluster_id = ? AND id <> ?", *target.ClusterID, target.ID).
		Order("COALESCE(published_at, created_at) DESC, id DESC").
		Limit(200).
		Scan(&peers).Error; err != nil {
		return clusterDiagnosisPayload{}, err
	}

	var (
		vectorMatchID    uint64
		vectorDistance   *float64
		vectorQueryError error
	)
	if options.Enabled {
		vectorMatchID, vectorDistance, vectorQueryError = h.queryClusterVectorNearest(ctx, target.ID, *target.ClusterID)
		if vectorQueryError != nil {
			if clustering.IsVectorUnavailableError(vectorQueryError) {
				payload.VectorEnabled = false
			} else {
				return clusterDiagnosisPayload{}, vectorQueryError
			}
		}
	}

	basis, matchedID, matchedDistance := inferClusterMatchBasis(
		target.CanonicalLink,
		target.NormalizedTitle,
		peers,
		vectorMatchID,
		vectorDistance,
		options.MaxDistance,
	)
	payload.MatchBasis = basis
	payload.MatchArticleID = matchedID
	payload.VectorDistance = matchedDistance
	return payload, nil
}

func (h *ArticleHandler) queryClusterVectorNearest(
	ctx context.Context,
	articleID uint64,
	clusterID uint64,
) (uint64, *float64, error) {
	var row struct {
		ArticleID uint64  `gorm:"column:article_id"`
		Distance  float64 `gorm:"column:distance"`
	}
	err := h.db.WithContext(ctx).
		Table("article_vectors self").
		Select("other.article_id AS article_id, (self.embedding <=> other.embedding) AS distance").
		Joins("JOIN article_vectors other ON other.article_id <> self.article_id").
		Joins("JOIN articles a ON a.id = other.article_id").
		Where("self.article_id = ?", articleID).
		Where("a.cluster_id = ?", clusterID).
		Order("distance ASC, other.article_id DESC").
		Limit(1).
		Scan(&row).Error
	if err != nil {
		return 0, nil, err
	}
	if row.ArticleID == 0 {
		return 0, nil, nil
	}
	distance := row.Distance
	return row.ArticleID, &distance, nil
}

func inferClusterMatchBasis(
	canonicalLink string,
	normalizedTitle string,
	peers []diagnosisPeerRow,
	vectorMatchID uint64,
	vectorDistance *float64,
	vectorMaxDistance float64,
) (string, *uint64, *float64) {
	canonical := strings.TrimSpace(canonicalLink)
	if canonical != "" {
		for _, peer := range peers {
			if canonical == strings.TrimSpace(peer.CanonicalLink) {
				matchID := peer.ID
				return "canonical_link", &matchID, nil
			}
		}
	}

	normalized := strings.TrimSpace(normalizedTitle)
	if normalized != "" {
		for _, peer := range peers {
			if normalized == strings.TrimSpace(peer.NormalizedTitle) {
				matchID := peer.ID
				return "normalized_title", &matchID, nil
			}
		}
	}

	if vectorDistance != nil && vectorMatchID > 0 && *vectorDistance <= vectorMaxDistance {
		matchID := vectorMatchID
		distance := *vectorDistance
		return "vector", &matchID, &distance
	}

	if len(peers) == 0 {
		return "single", nil, nil
	}
	return "unknown", nil, nil
}
