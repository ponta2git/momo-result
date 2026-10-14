package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type probeRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip probeRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestHTTPProbesRejectRedirectsWithoutForwardingCredentials(t *testing.T) {
	ctx := context.Background()
	local := func() bool { return probeLocalHTTP(ctx, "example.com", "test-only-token") == "" }
	for _, probe := range []struct {
		name         string
		redirectPath string
		accepts      func() bool
	}{
		{"local health", "/healthz", local},
		{"local web", "/", local},
		{"public edge", "/healthz", func() bool { return probePublicEdge(ctx, "example.com") == nil }},
	} {
		t.Run(probe.name, func(t *testing.T) {
			followed := false
			original := http.DefaultTransport
			http.DefaultTransport = probeRoundTripper(func(request *http.Request) (*http.Response, error) {
				response := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Request: request}
				body := `{"status":"ok"}`
				if request.URL.Path == "/" {
					body = `<div id="root"></div>`
				}
				if request.URL.Host == "redirect.invalid" {
					followed = true
				} else if request.URL.Path == probe.redirectPath {
					response.StatusCode = http.StatusFound
					response.Header.Set("Location", "https://redirect.invalid"+probe.redirectPath)
				}
				response.Body = io.NopCloser(strings.NewReader(body))
				return response, nil
			})
			t.Cleanup(func() { http.DefaultTransport = original })
			if probe.accepts() {
				t.Fatal("redirected response was accepted as candidate health")
			}
			if followed {
				t.Fatal("probe sent a request to the redirect target")
			}
		})
	}
}
