package handlers

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"quick/internal/models"
	"testing"
	"time"
)

func TestBriefingHighlightsUsesOnlyPriorityReasons(t *testing.T) {
	record := models.FeedBriefing{ArticleIDs: "30,10,20", GeneratedAt: time.Now(), Summary: "## 优先阅读\n- **Article** [A02] — 有具体实验数据，适合对比技术路线。\n- Bad [A99] — 不应出现的编号。\n- Duplicate [A02] — 不应重复出现的推荐。\n## 主题脉络\n- Other [A01] — 这是正文，不是推荐。"}
	rows := briefingHighlights(record)
	if len(rows) != 1 || rows[0].ArticleID != 10 || rows[0].Reason != "有具体实验数据，适合对比技术路线。" {
		t.Fatalf("unexpected highlights: %+v", rows)
	}
	record.Summary = "## 优先阅读\n- Title [A01]\n## 待观察\nAnything"
	if len(briefingHighlights(record)) != 0 {
		t.Fatal("invented a reason for a bare title")
	}
}

func TestFeedModeValidation(t *testing.T) {
	for _, mode := range []string{"all", "important", "invalid"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/feed?mode="+mode, nil)
		params, err := parseFeedListParams(c)
		if mode == "invalid" {
			if err == nil {
				t.Fatal("invalid mode accepted")
			}
			continue
		}
		if err != nil || params.important != (mode == "important") {
			t.Fatalf("mode=%s params=%+v err=%v", mode, params, err)
		}
	}
}
