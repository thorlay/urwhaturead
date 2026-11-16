package handlers

import (
	"context"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"quick/internal/models"
)

func (h *SourceHandler) EnsurePaperSources(ctx context.Context) ([]models.Source, error) {
	var sources []models.Source
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(0x717569636b706170)).Error; err != nil {
			return err
		}
		for _, preset := range []struct{ name, route string }{{"Hugging Face 论文日榜", "rsshub://huggingface/daily-papers/date"}, {"Hugging Face 论文周榜", "rsshub://huggingface/daily-papers/week"}} {
			rss, err := h.resolveSourceRSSURL(preset.route)
			if err != nil {
				return err
			}
			var source models.Source
			err = tx.Where("owner_user_id IS NULL AND rss_url IN ?", []string{rss, preset.route}).First(&source).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				source = models.Source{Name: preset.name, RSSURL: rss, SiteKey: "huggingface", Kind: "feed", Tags: models.StringArray{"papers", "ai"}, Enabled: true, PollIntervalSec: 1800, AIBriefingIntervalMin: 1440}
				if err := tx.Create(&source).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				source.Tags = mergeSourceTags(append([]string{"papers"}, source.Tags...))
				if err := tx.Model(&source).Updates(map[string]any{"tags": source.Tags, "rss_url": rss}).Error; err != nil {
					return err
				}
			}
			sources = append(sources, source)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("install paper feeds: %w", err)
	}
	return sources, nil
}
