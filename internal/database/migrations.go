package database

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"quick/internal/models"

	"gorm.io/gorm"
)

const schemaMigrationLockID int64 = 0x717569636b6d6967

type schemaMigration struct {
	Version int64
	Name    string
	Up      func(*gorm.DB) error
}

type schemaMigrationRecord struct {
	Version   int64     `gorm:"column:version;primaryKey"`
	Name      string    `gorm:"column:name;not null"`
	AppliedAt time.Time `gorm:"column:applied_at;not null"`
}

func (schemaMigrationRecord) TableName() string {
	return "schema_migrations"
}

// Migrate applies each schema change once under a PostgreSQL advisory lock.
// Migrations are transactional, so a failed startup never records partial work.
func Migrate(db *gorm.DB) ([]string, error) {
	if db == nil {
		return nil, errors.New("database is nil")
	}
	migrations := registeredSchemaMigrations()
	if err := validateSchemaMigrations(migrations); err != nil {
		return nil, err
	}

	appliedNames := make([]string, 0, len(migrations))
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", schemaMigrationLockID).Error; err != nil {
			return fmt.Errorf("acquire schema migration lock: %w", err)
		}
		if err := tx.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`).Error; err != nil {
			return fmt.Errorf("create schema_migrations table: %w", err)
		}

		var records []schemaMigrationRecord
		if err := tx.Order("version ASC").Find(&records).Error; err != nil {
			return fmt.Errorf("load schema migrations: %w", err)
		}
		applied := make(map[int64]string, len(records))
		for _, record := range records {
			applied[record.Version] = record.Name
		}

		for _, migration := range migrations {
			if recordedName, ok := applied[migration.Version]; ok {
				if recordedName != migration.Name {
					return fmt.Errorf(
						"schema migration %d name mismatch: database=%q code=%q",
						migration.Version,
						recordedName,
						migration.Name,
					)
				}
				continue
			}
			if err := migration.Up(tx); err != nil {
				return fmt.Errorf("apply schema migration %d %q: %w", migration.Version, migration.Name, err)
			}
			record := schemaMigrationRecord{
				Version:   migration.Version,
				Name:      migration.Name,
				AppliedAt: time.Now().UTC(),
			}
			if err := tx.Create(&record).Error; err != nil {
				return fmt.Errorf("record schema migration %d %q: %w", migration.Version, migration.Name, err)
			}
			appliedNames = append(appliedNames, migration.Name)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return appliedNames, nil
}

// Keep migration 1 as the legacy bootstrap. Every later model change must add
// a new, idempotent entry instead of relying on AutoMigrate at each startup.
func registeredSchemaMigrations() []schemaMigration {
	return []schemaMigration{
		{
			Version: 1,
			Name:    "gorm_schema_baseline",
			Up:      migrateGORMBaseline,
		},
	}
}

func migrateGORMBaseline(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&models.Source{},
		&models.EventCluster{},
		&models.Article{},
		&models.ArticleEnrichment{},
		&models.ArticleSummary{},
		&models.AITask{},
		&models.FeedBriefing{},
		&models.FeedBriefingArticle{},
		&models.SourceFetchLog{},
	); err != nil {
		return fmt.Errorf("migrate GORM baseline: %w", err)
	}
	if err := applyLegacyCompatibilitySchema(db); err != nil {
		return fmt.Errorf("apply compatibility schema: %w", err)
	}
	return nil
}

func validateSchemaMigrations(migrations []schemaMigration) error {
	seenVersions := make(map[int64]struct{}, len(migrations))
	seenNames := make(map[string]struct{}, len(migrations))
	for _, migration := range migrations {
		if migration.Version <= 0 {
			return fmt.Errorf("schema migration version must be positive: %d", migration.Version)
		}
		if migration.Name == "" {
			return fmt.Errorf("schema migration %d has an empty name", migration.Version)
		}
		if migration.Up == nil {
			return fmt.Errorf("schema migration %d %q has no Up function", migration.Version, migration.Name)
		}
		if _, exists := seenVersions[migration.Version]; exists {
			return fmt.Errorf("duplicate schema migration version: %d", migration.Version)
		}
		if _, exists := seenNames[migration.Name]; exists {
			return fmt.Errorf("duplicate schema migration name: %q", migration.Name)
		}
		seenVersions[migration.Version] = struct{}{}
		seenNames[migration.Name] = struct{}{}
	}
	if !sort.SliceIsSorted(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	}) {
		return errors.New("schema migrations must be ordered by version")
	}
	return nil
}
