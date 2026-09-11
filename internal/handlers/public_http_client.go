package handlers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxPublicHTTPRedirects = 10

var blockedPublicNetworks = mustParseCIDRs(
	"100.64.0.0/10", // Carrier-grade NAT.
	"198.18.0.0/15", // Network benchmark range.
)

type ipResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type contextDialer interface {
	DialContext(context.Context, string, string) (net.Conn, error)
}

func newPublicHTTPClient(timeout time.Duration, disableHTTP2 bool) *http.Client {
	client := newHandlerHTTPClient(timeout, disableHTTP2)
	transport := client.Transport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = publicDialContext(net.DefaultResolver, &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
	})
	client.Transport = transport
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxPublicHTTPRedirects {
			return errors.New("stopped after 10 redirects")
		}
		return validatePublicURLSyntax(req.URL)
	}
	return client
}

func validatePublicURLSyntax(parsed *url.URL) error {
	if parsed == nil {
		return errors.New("invalid URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("URL must use http or https")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return errors.New("URL host is required")
	}
	if isBlockedPublicHostname(host) {
		return errors.New("outbound host is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil && isBlockedPublicIP(ip) {
		return errors.New("outbound host is not allowed")
	}
	return nil
}

func publicDialContext(resolver ipResolver, dialer contextDialer) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("invalid outbound address: %w", err)
		}
		ips, err := resolvePublicIPs(ctx, resolver, host)
		if err != nil {
			return nil, err
		}

		type dialResult struct {
			connection net.Conn
			err        error
		}
		dialCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		results := make(chan dialResult)
		attempts := 0
		for _, item := range ips {
			if network == "tcp4" && item.IP.To4() == nil {
				continue
			}
			if network == "tcp6" && item.IP.To4() != nil {
				continue
			}
			attempts++
			target := net.JoinHostPort(item.String(), port)
			go func() {
				connection, dialErr := dialer.DialContext(dialCtx, network, target)
				select {
				case results <- dialResult{connection: connection, err: dialErr}:
				case <-dialCtx.Done():
					if connection != nil {
						_ = connection.Close()
					}
				}
			}()
		}
		if attempts == 0 {
			return nil, errors.New("outbound host has no compatible public address")
		}

		dialErrors := make([]error, 0, attempts)
		for range attempts {
			select {
			case result := <-results:
				if result.err == nil && result.connection != nil {
					cancel()
					return result.connection, nil
				}
				if result.err == nil {
					result.err = errors.New("dial returned no connection")
				}
				dialErrors = append(dialErrors, result.err)
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return nil, fmt.Errorf("connect to public host: %w", errors.Join(dialErrors...))
	}
}

func resolvePublicIPs(ctx context.Context, resolver ipResolver, host string) ([]net.IPAddr, error) {
	host = strings.TrimSpace(strings.TrimSuffix(host, "."))
	if host == "" || isBlockedPublicHostname(host) {
		return nil, errors.New("outbound host is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedPublicIP(ip) {
			return nil, errors.New("outbound host is not allowed")
		}
		return []net.IPAddr{{IP: ip}}, nil
	}

	ips, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("outbound host cannot be resolved")
	}
	for _, item := range ips {
		if isBlockedPublicIP(item.IP) {
			return nil, errors.New("outbound host is not allowed")
		}
	}
	return ips, nil
}

func isBlockedPublicHostname(host string) bool {
	host = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(host, ".")))
	return host == "localhost" ||
		strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal")
}

func isBlockedPublicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return true
	}
	for _, network := range blockedPublicNetworks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func mustParseCIDRs(values ...string) []*net.IPNet {
	result := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		_, network, err := net.ParseCIDR(value)
		if err != nil {
			panic(err)
		}
		result = append(result, network)
	}
	return result
}
