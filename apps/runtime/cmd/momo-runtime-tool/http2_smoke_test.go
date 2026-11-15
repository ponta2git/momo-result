package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDirectHTTP2ProbeAuthenticatesAndRejectsHTTP1(t *testing.T) {
	t.Parallel()
	for _, protocol := range []int{1, 2} {
		client := newProbeHTTPClient(localHTTPTimeout, probeRoundTripper(func(request *http.Request) (*http.Response, error) {
			if request.Host != "example.com" || request.URL.Host != "127.0.0.1:8080" ||
				request.URL.Path != http2ProbePath || request.Header.Get("X-Momo-Origin-Lock") != "test-only-token" ||
				request.Header.Get("X-Momo-Runtime-Probe") != "v1" {
				t.Fatal("direct API probe did not carry the expected target and authentication")
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				ProtoMajor: protocol,
				Body: io.NopCloser(strings.NewReader(
					`{"httpVersion":"HTTP/2.0","startedNanos":1,"finishedNanos":2}`,
				)),
			}, nil
		}))
		_, err := requestHTTP2Probe(context.Background(), client, "example.com", "test-only-token")
		if (err == nil) != (protocol == 2) {
			t.Fatalf("HTTP/%d acceptance disagrees with the wire protocol: %v", protocol, err)
		}
	}
}

func TestHTTP2ConcurrencyRequiresOverlappingServerExecution(t *testing.T) {
	t.Parallel()
	interval := func(start, finish int64) http2ProbePayload {
		return http2ProbePayload{HTTPVersion: "HTTP/2.0", StartedNanos: start, FinishedNanos: finish}
	}
	tests := []struct {
		name     string
		payloads []http2ProbePayload
		valid    bool
	}{
		{"overlap in completion order", []http2ProbePayload{interval(20, 40), interval(10, 30)}, true},
		{"negative monotonic origin", []http2ProbePayload{interval(-40, -10), interval(-30, -20)}, true},
		{"sequential", []http2ProbePayload{interval(10, 20), interval(30, 40)}, false},
		{"touching intervals", []http2ProbePayload{interval(10, 20), interval(20, 30)}, false},
		{"one request", []http2ProbePayload{interval(10, 20)}, false},
		{"no requests", nil, false},
		{"missing timestamps", []http2ProbePayload{{HTTPVersion: "HTTP/2.0"}, interval(10, 20)}, false},
		{"reversed interval", []http2ProbePayload{interval(20, 10), interval(5, 30)}, false},
		{"invalid result after overlap", []http2ProbePayload{interval(10, 30), interval(20, 40), {}}, false},
		{"wrong protocol", []http2ProbePayload{
			interval(10, 30),
			{HTTPVersion: "HTTP/1.1", StartedNanos: 20, FinishedNanos: 40},
		}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateHTTP2Concurrency(test.payloads)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v, error=%v", test.valid, err)
			}
		})
	}
}
