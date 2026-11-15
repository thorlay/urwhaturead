package worker

import (
	"context"
	"fmt"
	"github.com/mmcdole/gofeed"
	"net/http"
	"net/http/httptest"
	"quick/internal/feedextract"
	"testing"
)

func TestNGAReplyMetadataUsesBoardTotals(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("fid") != "-7" || r.Method != "POST" {
			t.Error("expected read-only board query")
		}
		fmt.Fprint(w, `{"code":0,"result":{"data":[{"tid":123,"replies":68},{"tid":124,"replies":0}]}}`)
	}))
	defer server.Close()
	worker := NewRSSWorker(nil, RSSWorkerOptions{NGAPassportUID: "test", NGAPassportCID: "test"})
	worker.ngaTopicEndpoint = server.URL
	feed := &gofeed.Feed{Items: []*gofeed.Item{{Link: "https://nga.178.com/read.php?tid=123"}, {Link: "https://nga.178.com/read.php?tid=124"}, {Link: "https://nga.178.com/read.php?tid=125"}}}
	worker.enrichNGAReplyCounts(context.Background(), "/nga/forum/-7", feed)
	for i, want := range []int{68, 0} {
		got := feedextract.ReplyCountFromFeedItem(feed.Items[i])
		if got == nil || *got != want {
			t.Fatalf("%d: %v", i, got)
		}
	}
	if feedextract.ReplyCountFromFeedItem(feed.Items[2]) != nil {
		t.Fatal("missing totals must remain unknown")
	}
}
