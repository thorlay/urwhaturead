package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"quick/internal/clustering"
	"quick/internal/config"
	"quick/internal/database"
	"quick/internal/models"

	"gorm.io/gorm"
)

type backfillArticleRow struct {
	ID              uint64
	ClusterID       *uint64
	HasVector       bool
	Link            string
	Title           string
	PublishedAt     *time.Time
	CreatedAt       time.Time
	CanonicalLink   string
	NormalizedTitle string
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := config.Load()
	clustering.ConfigureVector(clustering.VectorOptions{
		Enabled:     cfg.ClusterVectorEnabled,
		MaxDistance: cfg.ClusterVectorMaxDistance,
		MinTokens:   cfg.ClusterVectorMinTokens,
		IVFFlatList: cfg.ClusterVectorIVFFlatList,
	})
	db, err := database.New(cfg)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}

	if err := db.AutoMigrate(&models.EventCluster{}, &models.Article{}); err != nil {
		log.Fatalf("auto-migrate models: %v", err)
	}
	vectorReady := cfg.ClusterVectorEnabled
	if vectorReady {
		if err := clustering.EnsureVectorSchema(db); err != nil {
			vectorReady = false
			log.Printf("pgvector unavailable, fallback to rule-based clustering: %v", err)
		}
	} else {
		log.Printf("vector clustering is disabled by CLUSTER_VECTOR_ENABLED")
	}

	batchSize := envIntOrDefault("CLUSTER_BACKFILL_BATCH_SIZE", 500)
	if batchSize <= 0 {
		batchSize = 500
	}
	log.Printf("cluster backfill started (batch=%d)", batchSize)

	var (
		processed int
		failed    int
	)

	for {
		select {
		case <-ctx.Done():
			log.Printf("cluster backfill interrupted processed=%d failed=%d", processed, failed)
			return
		default:
		}

		var pending []backfillArticleRow
		query := db.WithContext(ctx).
			Table("articles").
			Select("id, cluster_id, false AS has_vector, link, title, published_at, created_at, canonical_link, normalized_title")
		if vectorReady {
			query = query.Select("id, cluster_id, EXISTS (SELECT 1 FROM article_vectors v WHERE v.article_id = articles.id) AS has_vector, link, title, published_at, created_at, canonical_link, normalized_title")
			query = query.Where("cluster_id IS NULL OR NOT EXISTS (SELECT 1 FROM article_vectors v WHERE v.article_id = articles.id)")
		} else {
			query = query.Where("cluster_id IS NULL")
		}
		if err := query.Order("id ASC").
			Limit(batchSize).
			Scan(&pending).Error; err != nil {
			log.Fatalf("query pending articles failed: %v", err)
		}
		if len(pending) == 0 {
			break
		}

		for _, item := range pending {
			err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				var current backfillArticleRow
				if err := tx.Table("articles").
					Select("id, cluster_id, false AS has_vector, link, title, published_at, created_at, canonical_link, normalized_title").
					Where("id = ?", item.ID).
					Take(&current).Error; err != nil {
					return err
				}
				if vectorReady {
					if err := tx.Table("articles").
						Select("id, cluster_id, EXISTS (SELECT 1 FROM article_vectors v WHERE v.article_id = articles.id) AS has_vector, link, title, published_at, created_at, canonical_link, normalized_title").
						Where("id = ?", item.ID).
						Take(&current).Error; err != nil {
						return err
					}
				}
				article := models.Article{
					ID:              current.ID,
					ClusterID:       current.ClusterID,
					Link:            current.Link,
					Title:           current.Title,
					PublishedAt:     current.PublishedAt,
					CreatedAt:       current.CreatedAt,
					CanonicalLink:   current.CanonicalLink,
					NormalizedTitle: current.NormalizedTitle,
				}
				if current.ClusterID != nil {
					if !vectorReady || current.HasVector {
						return nil
					}
					return clustering.EnsureArticleVector(tx, &article)
				}
				return clustering.AssignArticleToCluster(tx, &article)
			})
			if err != nil {
				failed++
				log.Printf("cluster backfill failed article_id=%d err=%v", item.ID, err)
				continue
			}
			processed++
		}

		log.Printf("cluster backfill progress processed=%d failed=%d remaining_batch=%d", processed, failed, len(pending))
	}

	log.Printf("cluster backfill completed processed=%d failed=%d", processed, failed)
}

func envIntOrDefault(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}
