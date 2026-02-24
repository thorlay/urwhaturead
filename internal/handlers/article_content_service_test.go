package handlers

import (
	"net/http"
	"testing"
)

func TestNewArticleContentService_RedditClientDisablesHTTP2(t *testing.T) {
	service := NewArticleContentService(ArticleHandlerOptions{})
	transport, ok := service.redditHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("reddit transport type=%T, want *http.Transport", service.redditHTTPClient.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("expected reddit transport ForceAttemptHTTP2=false")
	}
	if transport.TLSNextProto == nil {
		t.Fatalf("expected reddit transport TLSNextProto to disable http/2")
	}
}
