package handlers

import (
	"context"
	"errors"
	"fmt"

	"quick/internal/models"

	"gorm.io/gorm"
)

// EnsureForumSources installs the two discussion feeds against this deployment's RSSHub.
// It is explicit and repeatable; normal server startup never restores deleted subscriptions.
func (h *SourceHandler) EnsureForumSources(ctx context.Context) ([]models.Source, error) {
	return h.ensureForumPresets(ctx, []forumSourcePreset{
		{"V2EX 热门讨论（含回复）", "rsshub://v2ex/tab/hot"},
		{"Hacker News 高分讨论（100 分 / 30 评论）", "rsshub://hackernews/over/comments/100/30"},
	})
}

func (h *SourceHandler) EnsureNGAForumSources(ctx context.Context) ([]models.Source, error) {
	return h.ensureForumPresets(ctx, []forumSourcePreset{
		{"NGA 网事杂谈", "rsshub://nga/forum/-7"},
		{"NGA 游戏综合讨论", "rsshub://nga/forum/414"},
	})
}

type forumSourcePreset struct{ name, route string }

func (h *SourceHandler) ensureForumPresets(ctx context.Context, presets []forumSourcePreset) ([]models.Source, error) {
	sources := make([]models.Source, 0, len(presets))
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(0x717569636b666f72)).Error; err != nil {
			return err
		}
		for _, preset := range presets {
			rssURL, err := h.resolveSourceRSSURL(preset.route)
			if err != nil {
				return err
			}
			var source models.Source
			err = tx.Where("owner_user_id IS NULL AND rss_url IN ?", []string{rssURL, preset.route}).First(&source).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				source = models.Source{Name: preset.name, RSSURL: rssURL, Kind: "feed", SiteKey: normalizeSiteKey(rssURL), Tags: models.StringArray{"forum", "tech"}, Enabled: true, PollIntervalSec: 900, AIBriefingIntervalMin: 360}
				if err := tx.Create(&source).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				source.Tags = mergeSourceTags(append([]string{"forum"}, source.Tags...))
				if err := tx.Model(&source).Updates(map[string]any{"rss_url": rssURL, "tags": source.Tags}).Error; err != nil {
					return err
				}
			}
			normalizeSourceForResponse(&source)
			sources = append(sources, source)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("install forum sources: %w", err)
	}
	return sources, nil
}
