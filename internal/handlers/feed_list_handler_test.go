package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestParseFeedListParams(t *testing.T) {
	cursorValue := feedCursor{SortTime: time.Date(2026, 9, 12, 3, 4, 5, 6, time.UTC), ID: 42}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/feed?limit=35&dedupe=true&include_hidden=1&tag=Tech&q=agent&source_ids=7,9&since=2026-09-11T12:00:00%2B08:00&cursor="+encodeFeedCursor(cursorValue),
		nil,
	)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request

	params, err := parseFeedListParams(c)
	if err != nil {
		t.Fatalf("parseFeedListParams() error=%v", err)
	}
	if params.limit != 35 || !params.dedupe || !params.includeHidden {
		t.Fatalf("unexpected basic params: %+v", params)
	}
	if params.tag != "tech" || params.keyword != "agent" {
		t.Fatalf("unexpected filters: tag=%q keyword=%q", params.tag, params.keyword)
	}
	if len(params.sourceIDs) != 2 || params.sourceIDs[0] != 7 || params.sourceIDs[1] != 9 {
		t.Fatalf("unexpected source ids: %v", params.sourceIDs)
	}
	if params.since == nil || params.since.Format(time.RFC3339) != "2026-09-11T04:00:00Z" {
		t.Fatalf("unexpected since: %v", params.since)
	}
	if params.cursor == nil || params.cursor.ID != cursorValue.ID || !params.cursor.SortTime.Equal(cursorValue.SortTime) {
		t.Fatalf("unexpected cursor: %+v", params.cursor)
	}
}

func TestParseFeedListParamsRejectsInvalidValues(t *testing.T) {
	for _, target := range []string{
		"/api/v1/feed?limit=0",
		"/api/v1/feed?limit=101",
		"/api/v1/feed?source_ids=bad",
		"/api/v1/feed?since=yesterday",
		"/api/v1/feed?cursor=bad",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = request
		if _, err := parseFeedListParams(c); err == nil {
			t.Fatalf("parseFeedListParams(%q) expected an error", target)
		}
	}
}

func TestFeedCursorEncodingRemainsCompatible(t *testing.T) {
	cursor := feedCursor{SortTime: time.Unix(0, 123456789).UTC(), ID: 42}
	const expected = "MTIzNDU2Nzg5OjQy"
	if encoded := encodeFeedCursor(cursor); encoded != expected {
		t.Fatalf("encodeFeedCursor()=%q, want %q", encoded, expected)
	}
	decoded, err := decodeFeedCursor(expected)
	if err != nil {
		t.Fatalf("decodeFeedCursor() error=%v", err)
	}
	if decoded.ID != cursor.ID || !decoded.SortTime.Equal(cursor.SortTime) {
		t.Fatalf("decoded cursor=%+v, want %+v", decoded, cursor)
	}
}
