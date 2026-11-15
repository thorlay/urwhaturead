package main

import (
	"flag"
	"gorm.io/gorm"
	"log"
	"quick/internal/config"
	"quick/internal/database"
	"quick/internal/feedextract"
	"quick/internal/models"
)

// Reparse only recent forum metadata, preserving article content and subscriptions.
func main() {
	apply := flag.Bool("apply", false, "Write corrected counts; default only previews total changes")
	sourceID := flag.Uint64("source-id", 0, "Limit corrections to one source")
	flag.Parse()
	db, err := database.New(config.Load())
	if err != nil {
		log.Fatal(err)
	}
	var rows []models.Article
	query := db.Table("articles a").Select("a.id,a.raw,a.reply_count").Joins("JOIN sources s ON s.id=a.source_id").Where(`coalesce(a.published_at,a.created_at)>now()-interval '3 days' AND (s.tags @> ARRAY['forum']::text[] OR s.site_key IN ('v2ex','v2ex.com','hackernews','news.ycombinator.com','hnrss.org','nga','reddit','uscardforum.com','linux.do','1point3acres','tieba') OR s.rss_url ~* '/(v2ex|hackernews|nga|reddit|uscardforum|linuxdo|1point3acres|tieba)/')`)
	if *sourceID > 0 {
		query = query.Where("a.source_id=?", *sourceID)
	}
	err = query.Scan(&rows).Error
	if err != nil {
		log.Fatal(err)
	}
	changed := 0
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			count := feedextract.ForumReplyCountFromRaw(row.Raw)
			if (count == nil && row.ReplyCount == nil) || (count != nil && row.ReplyCount != nil && *count == *row.ReplyCount) {
				continue
			}
			changed++
			if *apply {
				if err := tx.Model(&models.Article{}).Where("id=?", row.ID).Update("reply_count", count).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("checked=%d corrected=%d applied=%t", len(rows), changed, *apply)
}
