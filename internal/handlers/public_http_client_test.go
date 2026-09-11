package handlers

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"
)

type staticIPResolver struct {
	ips []net.IPAddr
	err error
}

type recordingDialer struct {
	address string
	calls   int
}

func (d *recordingDialer) DialContext(_ context.Context, _, address string) (net.Conn, error) {
	d.calls++
	d.address = address
	client, server := net.Pipe()
	_ = server.Close()
	return client, nil
}

func (r staticIPResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return r.ips, r.err
}

func TestIsBlockedPublicIP(t *testing.T) {
	tests := []struct {
		ip      string
		blocked bool
	}{
		{ip: "127.0.0.1", blocked: true},
		{ip: "10.0.0.1", blocked: true},
		{ip: "169.254.169.254", blocked: true},
		{ip: "100.64.0.1", blocked: true},
		{ip: "198.18.0.1", blocked: true},
		{ip: "224.0.0.1", blocked: true},
		{ip: "::1", blocked: true},
		{ip: "fc00::1", blocked: true},
		{ip: "1.1.1.1", blocked: false},
		{ip: "2606:4700:4700::1111", blocked: false},
	}
	for _, test := range tests {
		t.Run(test.ip, func(t *testing.T) {
			if got := isBlockedPublicIP(net.ParseIP(test.ip)); got != test.blocked {
				t.Fatalf("isBlockedPublicIP(%s)=%v, want %v", test.ip, got, test.blocked)
			}
		})
	}
}

func TestResolvePublicIPsRejectsMixedDNSAnswers(t *testing.T) {
	resolver := staticIPResolver{ips: []net.IPAddr{
		{IP: net.ParseIP("93.184.216.34")},
		{IP: net.ParseIP("127.0.0.1")},
	}}
	if _, err := resolvePublicIPs(context.Background(), resolver, "example.com"); err == nil {
		t.Fatal("mixed public/private DNS answers should be rejected")
	}
}

func TestResolvePublicIPsAllowsPublicDNSAnswers(t *testing.T) {
	resolver := staticIPResolver{ips: []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}}
	ips, err := resolvePublicIPs(context.Background(), resolver, "example.com")
	if err != nil {
		t.Fatalf("resolvePublicIPs: %v", err)
	}
	if len(ips) != 1 || !ips[0].IP.Equal(net.ParseIP("93.184.216.34")) {
		t.Fatalf("unexpected resolved addresses: %v", ips)
	}
}

func TestResolvePublicIPsRejectsResolverFailure(t *testing.T) {
	resolver := staticIPResolver{err: errors.New("lookup failed")}
	if _, err := resolvePublicIPs(context.Background(), resolver, "example.com"); err == nil {
		t.Fatal("resolver failure should be rejected")
	}
}

func TestPublicDialerPinsResolvedAddress(t *testing.T) {
	resolver := staticIPResolver{ips: []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}}
	dialer := &recordingDialer{}
	dial := publicDialContext(resolver, dialer)
	connection, err := dial(context.Background(), "tcp", "example.com:443")
	if err != nil {
		t.Fatalf("dial public address: %v", err)
	}
	_ = connection.Close()
	if dialer.calls != 1 || dialer.address != "93.184.216.34:443" {
		t.Fatalf("dial calls=%d address=%q", dialer.calls, dialer.address)
	}
}

func TestPublicDialerNeverConnectsToPrivateAnswer(t *testing.T) {
	resolver := staticIPResolver{ips: []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}}
	dialer := &recordingDialer{}
	dial := publicDialContext(resolver, dialer)
	if _, err := dial(context.Background(), "tcp", "example.com:80"); err == nil {
		t.Fatal("private DNS answer should be rejected")
	}
	if dialer.calls != 0 {
		t.Fatalf("private address reached dialer %d times", dialer.calls)
	}
}

func TestPublicHTTPClientRestrictsRedirects(t *testing.T) {
	client := newPublicHTTPClient(time.Second, false)
	privateURL, _ := url.Parse("http://127.0.0.1/private")
	request := &http.Request{URL: privateURL}
	if err := client.CheckRedirect(request, nil); err == nil {
		t.Fatal("redirect to private host should be rejected")
	}

	publicURL, _ := url.Parse("https://93.184.216.34/image.png")
	request.URL = publicURL
	via := make([]*http.Request, maxPublicHTTPRedirects)
	if err := client.CheckRedirect(request, via); err == nil {
		t.Fatal("redirect chain at the limit should be rejected")
	}
}

func TestPublicHTTPClientBypassesEnvironmentProxy(t *testing.T) {
	client := newPublicHTTPClient(time.Second, false)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type=%T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("public fetch client should not use environment proxies")
	}
	if transport.DialContext == nil {
		t.Fatal("public fetch client must validate the address at dial time")
	}
}
