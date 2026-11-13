package handlers

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/models"
)

func TestForumSourceInstallationIsRepeatable(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN is required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	schema := fmt.Sprintf("forum_sources_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	scoped, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	scopedSQL, _ := scoped.DB()
	defer scopedSQL.Close()
	if err := scoped.AutoMigrate(&models.Source{}); err != nil {
		t.Fatal(err)
	}
	h := NewSourceHandlerWithOptions(scoped, nil, SourceHandlerOptions{RSSHubBaseURL: "http://rsshub:1200"})
	first, err := h.EnsureForumSources(context.Background())
	if err != nil || len(first) != 2 {
		t.Fatalf("install: %v, %v", first, err)
	}
	scoped.Model(&first[0]).Update("enabled", false)
	second, err := h.EnsureForumSources(context.Background())
	if err != nil || len(second) != 2 || second[0].ID != first[0].ID || second[0].Enabled {
		t.Fatalf("repeat must preserve IDs and disabled preferences: %v, %v", second, err)
	}
	var count int64
	scoped.Model(&models.Source{}).Count(&count)
	if count != 2 || second[1].RSSURL != "http://rsshub:1200/hackernews/over/comments/100/30" || second[1].Tags[0] != "forum" {
		t.Fatal("expected exactly two tagged feeds on the configured RSSHub")
	}
	nga, err := h.EnsureNGAForumSources(context.Background())
	if err != nil || len(nga) != 2 || nga[0].RSSURL != "http://rsshub:1200/nga/forum/-7" || nga[1].RSSURL != "http://rsshub:1200/nga/forum/414" {
		t.Fatalf("NGA presets must target the user-selected boards: %v, %v", nga, err)
	}
	if _, err := h.EnsureNGAForumSources(context.Background()); err != nil {
		t.Fatal(err)
	}
	scoped.Model(&models.Source{}).Count(&count)
	if count != 4 {
		t.Fatal("reinstalling NGA must not duplicate subscriptions")
	}
}
