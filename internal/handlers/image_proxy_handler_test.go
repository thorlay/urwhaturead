package handlers

import (
	"net/url"
	"strings"
	"testing"
)

func TestValidateProxyImageURLRejectsPrivateHosts(t *testing.T) {
	inputs := []string{
		"http://127.0.0.1:1200/a.png",
		"http://localhost/a.png",
		"http://10.0.0.12/a.png",
		"http://192.168.1.2/a.png",
	}

	for _, input := range inputs {
		parsed, err := url.Parse(input)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", input, err)
		}
		if err := validateProxyImageURL(parsed); err == nil {
			t.Fatalf("validateProxyImageURL(%q) should reject private/local host", input)
		}
	}
}

func TestValidateProxyImageURLRejectsUnsupportedSchemes(t *testing.T) {
	parsed, err := url.Parse("file:///tmp/a.png")
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	if err := validateProxyImageURL(parsed); err == nil || !strings.Contains(err.Error(), "http or https") {
		t.Fatalf("validateProxyImageURL() error=%v, want scheme rejection", err)
	}
}

func TestValidateProxyImageURLAllowsPublicIP(t *testing.T) {
	parsed, err := url.Parse("https://93.184.216.34/image.png")
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	if err := validateProxyImageURL(parsed); err != nil {
		t.Fatalf("validateProxyImageURL() unexpected error: %v", err)
	}
}
