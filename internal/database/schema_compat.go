package database

import (
	"fmt"

	"gorm.io/gorm"
)

// applyLegacyCompatibilitySchema upgrades databases created before versioned
// migrations were introduced. It is only called by the baseline migration.
func applyLegacyCompatibilitySchema(db *gorm.DB) error {
	if err := ensureSourceTagSchema(db); err != nil {
		return err
	}
	if err := ensureFeedBriefingTagSchema(db); err != nil {
		return err
	}
	if err := ensureArticleFeedIndexes(db); err != nil {
		return err
	}
	return nil
}

func ensureSourceTagSchema(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE sources ADD COLUMN IF NOT EXISTS tags TEXT[]`,
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'category'
			) THEN
				UPDATE sources
				SET tags = ARRAY[LOWER(TRIM(category))]
				WHERE (tags IS NULL OR cardinality(tags) = 0) AND TRIM(category) <> '';
			END IF;
		END
		$$`,
		`UPDATE sources SET tags = ARRAY['general']
		 WHERE tags IS NULL OR cardinality(tags) = 0`,
		`ALTER TABLE sources ALTER COLUMN tags SET NOT NULL`,
		`ALTER TABLE sources ALTER COLUMN tags SET DEFAULT '{}'`,
		`CREATE INDEX IF NOT EXISTS ix_sources_tags_gin ON sources USING GIN(tags)`,
		`ALTER TABLE sources DROP COLUMN IF EXISTS category`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("exec source compatibility statement failed: %w", err)
		}
	}
	return nil
}

func ensureFeedBriefingTagSchema(db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE feed_briefings ADD COLUMN IF NOT EXISTS tag TEXT`,
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'feed_briefings' AND column_name = 'category'
			) THEN
				UPDATE feed_briefings
				SET tag = category
				WHERE COALESCE(tag, '') = '';
			END IF;
		END
		$$`,
		`UPDATE feed_briefings SET tag = '' WHERE tag IS NULL`,
		`ALTER TABLE feed_briefings ALTER COLUMN tag SET NOT NULL`,
		`ALTER TABLE feed_briefings ALTER COLUMN tag SET DEFAULT ''`,
		`ALTER TABLE feed_briefings DROP COLUMN IF EXISTS category`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("exec feed briefing compatibility statement failed: %w", err)
		}
	}
	return nil
}

func ensureArticleFeedIndexes(db *gorm.DB) error {
	statements := []string{
		`CREATE INDEX IF NOT EXISTS ix_articles_created_at
		 ON articles(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS ix_articles_feed_sort
		 ON articles((COALESCE(published_at, created_at)) DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS ix_articles_source_feed_sort
		 ON articles(source_id, (COALESCE(published_at, created_at)) DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS ix_articles_cluster_feed_sort
		 ON articles((COALESCE(cluster_id, id)), (COALESCE(published_at, created_at)) DESC, id DESC)`,
	}
	for _, stmt := range statements {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("exec article feed index statement failed: %w", err)
		}
	}
	return nil
}
