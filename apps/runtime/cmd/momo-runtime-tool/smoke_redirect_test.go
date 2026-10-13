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
	for _, redirectPath := range []string{"/healthz", "/"} {
		t.Run("local"+redirectPath, func(t *testing.T) {
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
				} else if request.URL.Path == redirectPath {
					response.StatusCode = http.StatusFound
					response.Header.Set("Location", "https://redirect.invalid"+redirectPath)
				}
				response.Body = io.NopCloser(strings.NewReader(body))
				return response, nil
			})
			t.Cleanup(func() { http.DefaultTransport = original })
			if result := probeLocalHTTP(context.Background(), "example.com", "test-only-token"); result == "" {
				t.Fatal("redirected local response was accepted as candidate health")
			}
			if followed {
				t.Fatal("probe sent a request to the redirect target")
			}
		})
	}
	t.Run("public edge", func(t *testing.T) {
		followed := false
		original := http.DefaultTransport
		http.DefaultTransport = probeRoundTripper(func(request *http.Request) (*http.Response, error) {
			response := &http.Response{
				StatusCode: http.StatusOK, Header: make(http.Header), Request: request,
				Body: io.NopCloser(strings.NewReader(`{"status":"ok"}`)),
			}
			if request.URL.Host == "redirect.invalid" {
				followed = true
			} else {
				response.StatusCode = http.StatusFound
				response.Header.Set("Location", "https://redirect.invalid/healthz")
			}
			return response, nil
		})
		t.Cleanup(func() { http.DefaultTransport = original })
		if err := probePublicEdge(context.Background(), "example.com"); err == nil {
			t.Fatal("redirected response was accepted as public edge health")
		}
		if followed {
			t.Fatal("public edge probe sent a request to the redirect target")
		}
	})
}
