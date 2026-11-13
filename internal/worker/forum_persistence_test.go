package worker

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quick/internal/models"
)

func TestForumReplyRefreshPersistence(t *testing.T) {
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
	schema := fmt.Sprintf("forum_refresh_%d", time.Now().UnixNano())
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
	if err := scoped.AutoMigrate(&models.Article{}); err != nil {
		t.Fatal(err)
	}
	// Production's explicit migration supplies the thread identity index.
	if err := scoped.Exec("CREATE UNIQUE INDEX forum_article_link ON articles(source_id, link)").Error; err != nil {
		t.Fatal(err)
	}
	w := NewRSSWorker(scoped, RSSWorkerOptions{})
	item := &gofeed.Item{GUID: "123", Title: "Discussion", Link: "https://v2ex.com/t/123", Description: "<p>First reply</p>"}
	first, _ := mapFeedItemToArticle(1, item)
	if created, err := w.saveArticleIfNew(context.Background(), first); err != nil || !created {
		t.Fatalf("initial save: %v, %v", created, err)
	}
	item.Description += "<p>Later disagreement</p>"
	second, _ := mapFeedItemToArticle(1, item)
	if created, err := w.saveArticleIfNew(context.Background(), second); err != nil || created {
		t.Fatalf("reply refresh should update existing row: %v, %v", created, err)
	}
	var articles []models.Article
	if err := scoped.Find(&articles).Error; err != nil {
		t.Fatal(err)
	}
	if len(articles) != 1 || articles[0].Content == nil || *articles[0].Content != *second.Content || articles[0].ContentHash != second.ContentHash {
		t.Fatal("updated replies and revision must persist without duplicate threads")
	}
}
