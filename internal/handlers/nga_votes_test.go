package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNGAVotesJoinByReplyIDAndKeepUnknownDistinctFromZero(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.FormValue("tid") != "123" {
			t.Error("expected read-only post-list request")
		}
		if r.Header.Get("Cookie") != "ngaPassportUid=test-uid; ngaPassportCid=test-cid;" {
			t.Error("missing configured NGA session")
		}
		fmt.Fprint(w, `{"code":0,"result":[{"pid":22,"vote_good":"36","vote_bad":2},{"pid":11,"vote_good":0},{"pid":33}]}`)
	}))
	defer server.Close()
	s := NewArticleContentService(ArticleHandlerOptions{NGAPassportUID: "test-uid", NGAPassportCID: "test-cid"})
	s.ngaVoteEndpoint = server.URL
	thread := &articleThread{Comments: []articleThreadComment{
		{Link: "https://nga.178.com/read.php?tid=123#postcontent11"},
		{Link: "https://nga.178.com/read.php?tid=123#postcontent22"},
		{Link: "https://nga.178.com/read.php?tid=123#postcontent33"},
	}}
	s.enrichNGAVotes(context.Background(), "123", thread)
	if thread.Comments[0].Upvotes == nil || *thread.Comments[0].Upvotes != 0 || thread.Comments[1].Upvotes == nil || *thread.Comments[1].Upvotes != 36 || thread.Comments[2].Upvotes != nil {
		t.Fatalf("votes should match post IDs, not response order: %+v", thread.Comments)
	}
	payload, _ := json.Marshal(thread)
	var roundtrip articleThread
	json.Unmarshal(payload, &roundtrip)
	if roundtrip.VoteMetadataVersion != 1 || roundtrip.Comments[1].Upvotes == nil || *roundtrip.Comments[1].Upvotes != 36 {
		t.Fatal("vote metadata must survive enrichment persistence")
	}
}

func TestNGAInvalidAndMissingVotesAreNotZero(t *testing.T) {
	for _, value := range []string{"", "null", `""`, `"bad"`, "-1", "1.5", "{}"} {
		if parseNGAUpvotes(json.RawMessage(value)) != nil {
			t.Fatalf("invalid vote count %q", value)
		}
	}
}

func TestNGAVoteFailureDoesNotBreakReadableCommentsOrForwardSession(t *testing.T) {
	var forwarded bool
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded = true }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	defer server.Close()
	s := NewArticleContentService(ArticleHandlerOptions{NGAPassportUID: "uid", NGAPassportCID: "cid"})
	s.ngaVoteEndpoint = server.URL
	thread := &articleThread{Comments: []articleThreadComment{{Content: "Readable reply"}}}
	s.enrichNGAVotes(context.Background(), "123", thread)
	if forwarded || thread.Comments[0].Content != "Readable reply" || thread.Comments[0].Upvotes != nil {
		t.Fatal("vote failures must retain comments and never follow authenticated redirects")
	}
}
