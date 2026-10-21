package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMaintenanceHTTPRequiresHealthAndWriterFence(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusOK, http.StatusFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			original := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = original })
			count := 0
			http.DefaultTransport = probeRoundTripper(func(request *http.Request) (*http.Response, error) {
				count++
				if request.URL.Host != "127.0.0.1:8080" || request.Host != "example.com" || request.Header.Get("X-Momo-Origin-Lock") != "test-only-token" {
					t.Fatal("probe left local listener or omitted origin authentication")
				}
				code := status
				if request.URL.Path == "/healthz" {
					code = http.StatusOK
				}
				return &http.Response{StatusCode: code, Header: http.Header{"Location": []string{"https://redirect.invalid/"}}, Body: io.NopCloser(strings.NewReader(`{"status":"ok"}`)), Request: request}, nil
			})
			accepted := probeMaintenanceHTTP(context.Background(), "example.com", "test-only-token") == ""
			if accepted != (status == http.StatusServiceUnavailable) || count != 2 {
				t.Fatal("maintenance contract accepted wrong readiness or followed redirect")
			}
		})
	}
}
