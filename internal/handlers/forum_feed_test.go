package handlers

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"quick/internal/models"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestForumScopeAndCursor(t *testing.T) {
	count := 42
	cursor := encodeFeedCursor(feedCursor{ID: 7, SortTime: time.Now(), Replies: &count})
	for _, tc := range []struct {
		query, channel string
		invalid        bool
	}{
		{"", "news", false}, {"?tag=forum", "forum", false}, {"?source_ids=7", "all", false},
		{"?channel=forum&cursor=" + cursor, "forum", false},
		{"?channel=forum&cursor=" + encodeFeedCursor(feedCursor{ID: 7, SortTime: time.Now()}), "", true},
		{"?channel=invalid", "", true}, {"?min_replies=-1", "", true},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/feed"+tc.query, nil)
		params, err := parseFeedListParams(c)
		if (err != nil) != tc.invalid || (!tc.invalid && params.channel != tc.channel) {
			t.Fatalf("%s: %+v %v", tc.query, params, err)
		}
	}
}

func TestForumRankingAndNewsIsolation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	schema := fmt.Sprintf("forum_rank_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	db, err = gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql2, _ := db.DB()
	defer sql2.Close()
	for _, q := range []string{
		`CREATE TABLE sources(id bigint, name text, tags text[], site_key text,rss_url text,hidden_in_sidebar boolean default false,kind text default 'feed')`,
		`CREATE TABLE articles(id bigint,source_id bigint,cluster_id bigint,title text,link text,raw jsonb,summary text,author text,published_at timestamptz,image_url text,reply_count int,created_at timestamptz default now())`,
		`CREATE TABLE event_clusters(id bigint,article_count int)`,
		`INSERT INTO sources(id,name,tags,site_key,rss_url) VALUES(1,'news',ARRAY['tech'],'news','https://example.com/feed'),(2,'old forum',ARRAY['tech'],'v2ex','rsshub://v2ex/tab/hot')`,
		`INSERT INTO articles(id,source_id,title,link,published_at,reply_count) VALUES(1,1,'news','https://example.com',now(),100),(2,2,'popular','https://v2ex.com/t/2',now()-interval '1 hour',100),(3,2,'second','https://v2ex.com/t/3',now(),50),(4,2,'quiet','https://v2ex.com/t/4',now(),19),(5,2,'old','https://v2ex.com/t/5',now()-interval '4 days',900),(6,2,'unknown','https://v2ex.com/t/6',now(),NULL),(7,2,'duplicate','https://www.v2ex.com/t/2',now(),99)`,
	} {
		if err := db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO articles(id,source_id,title,link,raw) VALUES(8,2,'HN article','https://example.com/article','{"guid":"https://news.ycombinator.com/item?id=123"}')`).Error; err != nil {
		t.Fatal(err)
	}
	h := NewFeedHandler(db, nil, FeedHandlerOptions{})
	refs, err := h.loadArticleRefsForBriefings(context.Background(), []models.FeedBriefing{{DigestKey: "forum", Tag: "forum", ArticleIDs: "8"}, {DigestKey: "news", ArticleIDs: "8"}}, map[uint64]string{2: "HN"})
	if err != nil || refs["forum"][0].Link != "https://news.ycombinator.com/item?id=123" || refs["news"][0].Link != "https://example.com/article" {
		t.Fatalf("forum references must preserve discussion links: %+v %v", refs, err)
	}

	repo := newFeedRepository(db)
	news, e := repo.list(context.Background(), feedListParams{channel: "news", limit: 20})
	if e != nil || len(news.rows) != 1 || news.rows[0].ID != 1 {
		t.Fatalf("news: %+v %v", news, e)
	}
	forum, e := repo.list(context.Background(), feedListParams{channel: "forum", minReplies: 20, limit: 1})
	if e != nil || len(forum.rows) != 2 || forum.rows[0].ID != 2 || forum.rows[1].ID != 3 {
		t.Fatalf("forum: %+v %v", forum, e)
	}
	first := forum.rows[0]
	next, e := repo.list(context.Background(), feedListParams{channel: "forum", minReplies: 20, limit: 1, cursor: &feedCursor{ID: first.ID, SortTime: first.SortTime, Replies: first.ReplyCount}})
	if e != nil || len(next.rows) != 1 || next.rows[0].ID != 3 {
		t.Fatalf("page: %+v %v", next, e)
	}
}
