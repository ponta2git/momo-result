package main

import "testing"

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
