package handlers

import (
	"context"
	"errors"
	"fmt"

	"quick/internal/forumpublic"
	"quick/internal/models"

	"gorm.io/gorm"
)

// EnsureForumSources installs the two discussion feeds against this deployment's RSSHub.
// It is explicit and repeatable; normal server startup never restores deleted subscriptions.
func (h *SourceHandler) EnsureForumSources(ctx context.Context) ([]models.Source, error) {
	return h.ensureForumPresets(ctx, []forumSourcePreset{
		{name: "V2EX 热门讨论（含回复）", route: "rsshub://v2ex/tab/hot"},
		{name: "Hacker News 高分讨论（100 分 / 30 评论）", route: "rsshub://hackernews/over/comments/100/30"},
	})
}

func (h *SourceHandler) EnsureNGAForumSources(ctx context.Context) ([]models.Source, error) {
	return h.ensureForumPresets(ctx, []forumSourcePreset{
		{name: "NGA 网事杂谈", route: "rsshub://nga/forum/-7"},
		{name: "NGA 游戏综合讨论", route: "rsshub://nga/forum/414"},
	})
}

func (h *SourceHandler) EnsurePublicForumSources(ctx context.Context) ([]models.Source, error) {
	return h.ensureForumPresets(ctx, []forumSourcePreset{
		{name: "Lobsters 热门", route: forumpublic.LobstersFeed, tag: "tech", intervalSec: 1800},
		{name: "Bogleheads 投资版", route: forumpublic.BogleheadsFeed, tag: "finance", intervalSec: 300},
	})
}

type forumSourcePreset struct {
	name, route string
	tag         string
	intervalSec int
}

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
				tag := preset.tag
				if tag == "" {
					tag = "tech"
				}
				interval := preset.intervalSec
				if interval <= 0 {
					interval = 900
				}
				source = models.Source{Name: preset.name, RSSURL: rssURL, Kind: "feed", SiteKey: normalizeSiteKey(rssURL), Tags: models.StringArray{"forum", tag}, Enabled: true, PollIntervalSec: interval, AIBriefingIntervalMin: 360}
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
