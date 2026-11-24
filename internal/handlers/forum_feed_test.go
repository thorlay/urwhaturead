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
		`CREATE TABLE articles(id bigint,source_id bigint,cluster_id bigint,title text,link text,raw jsonb,summary text,author text,published_at timestamptz,image_url text,reply_count int,forum_activity_at timestamptz,created_at timestamptz default now())`,
		`CREATE TABLE event_clusters(id bigint,article_count int)`,
		`INSERT INTO sources(id,name,tags,site_key,rss_url) VALUES(1,'news',ARRAY['tech'],'news','https://example.com/feed'),(2,'old forum',ARRAY['tech'],'v2ex','rsshub://v2ex/tab/hot')`,
		`INSERT INTO articles(id,source_id,title,link,published_at,reply_count) VALUES(1,1,'news','https://example.com',now(),100),(2,2,'popular','https://v2ex.com/t/2',now()-interval '1 hour',100),(3,2,'second','https://v2ex.com/t/3',now(),50),(4,2,'quiet','https://v2ex.com/t/4',now(),19),(5,2,'old','https://v2ex.com/t/5',now()-interval '25 hours',900),(6,2,'unknown','https://v2ex.com/t/6',now(),NULL),(7,2,'duplicate','https://www.v2ex.com/t/2',now(),99),(9,2,'future','https://v2ex.com/t/9',now()+interval '1 hour',9999)`,
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
	for _, q := range []string{
		`INSERT INTO sources(id,name,tags,site_key,rss_url) VALUES(3,'Bogleheads',ARRAY['forum'],'bogleheads.org','https://www.bogleheads.org/forum/feed/forum/10'),(4,'Lobsters',ARRAY['forum'],'lobste.rs','https://lobste.rs/rss')`,
		`INSERT INTO articles(id,source_id,title,link,published_at,forum_activity_at,raw)
		SELECT id, source, 'ongoing', 'https://example.com/topic/' || id,
			now()-interval '10 days', now()-interval '1 hour',
			jsonb_build_object('public_discussion', jsonb_build_object('replies', (
				SELECT jsonb_agg(jsonb_build_object('at', now() - hours * interval '1 hour')) FROM unnest(sample) AS hours
			)))
		FROM (VALUES (10,3,ARRAY[1,2,3,25,-1]), (11,3,ARRAY[1,2,26]), (12,4,ARRAY[1,2,3,4,5]), (13,4,ARRAY[1,2,3,4,28])) AS rows(id,source,sample)`,
	} {
		if err := db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	recent, e := repo.list(context.Background(), feedListParams{channel: "forum", minReplies: 20, sourceIDs: []uint64{3, 4}, limit: 5})
	if e != nil || len(recent.rows) != 2 || recent.rows[0].ID != 12 || recent.rows[1].ID != 10 ||
		recent.rows[0].RecentReplyCount == nil || *recent.rows[0].RecentReplyCount != 5 ||
		recent.rows[1].RecentReplyCount == nil || *recent.rows[1].RecentReplyCount != 3 {
		t.Fatalf("recent activity: %+v %v", recent, e)
	}
	strict, e := repo.list(context.Background(), feedListParams{channel: "forum", minReplies: 6, minRepliesSet: true, sourceIDs: []uint64{3, 4}, limit: 5})
	if e != nil || len(strict.rows) != 0 {
		t.Fatalf("explicit reply threshold: %+v %v", strict, e)
	}

}
