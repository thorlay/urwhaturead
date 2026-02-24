package handlers

import (
	"net/http"
	"testing"
	"time"
)

func TestPickHTTPClientForURL(t *testing.T) {
	defaultClient := &http.Client{}
	redditClient := &http.Client{}

	if got := pickHTTPClientForURL("https://www.reddit.com/r/technology/top.rss", defaultClient, redditClient); got != redditClient {
		t.Fatalf("expected reddit client for reddit url")
	}
	if got := pickHTTPClientForURL("https://hnrss.org/frontpage", defaultClient, redditClient); got != defaultClient {
		t.Fatalf("expected default client for non-reddit url")
	}
}

func TestNewHandlerHTTPClient_DisablesHTTP2WhenRequested(t *testing.T) {
	client := newHandlerHTTPClient(3*time.Second, true)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client transport=%T, want *http.Transport", client.Transport)
	}
	if transport.ForceAttemptHTTP2 {
		t.Fatalf("expected ForceAttemptHTTP2=false")
	}
	if transport.TLSNextProto == nil {
		t.Fatalf("expected TLSNextProto to be set when disabling http2")
	}
	if transport.TLSClientConfig == nil || len(transport.TLSClientConfig.NextProtos) != 1 || transport.TLSClientConfig.NextProtos[0] != "http/1.1" {
		t.Fatalf("expected TLSClientConfig.NextProtos=[http/1.1], got=%v", transport.TLSClientConfig)
	}
}
