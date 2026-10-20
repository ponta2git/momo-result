package main

import (
	"context"
	"io"
	"net/http"
	"os"
)

const maintenanceSmokeEvent = "runtime_maintenance_smoke"

// The maintenance probe is local-only: it must never contact the public edge,
// a database, or an external service while writers are fenced.
func runMaintenanceSmoke(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	host := environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost)
	token := os.Getenv("MOMO_ORIGIN_LOCK_TOKEN")
	if os.Getenv("MOMO_CUTOVER_MODE") != "maintenance" || token == "" || validateHost(host) != nil {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "MissingOrInvalidConfiguration"))
		return 1
	}
	if errorClass := probeMaintenanceHTTP(ctx, host, token); errorClass != "" {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, errorClass))
		return 1
	}
	writeResult(stdout, successResult(maintenanceSmokeEvent))
	return 0
}

func probeMaintenanceHTTP(ctx context.Context, host, token string) string {
	client := newProbeHTTPClient(localHTTPTimeout, nil)
	for _, probe := range []struct {
		path   string
		status int
	}{{"/healthz", http.StatusOK}, {"/api/events", http.StatusServiceUnavailable}} {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:8080"+probe.path, nil)
		if err != nil {
			return "MaintenanceHTTPContractError"
		}
		request.Host = host
		request.Header.Set("X-Momo-Origin-Lock", token)
		response, err := client.Do(request)
		if err != nil {
			return "MaintenanceHTTPContractError"
		}
		valid := response.StatusCode == probe.status
		response.Body.Close()
		if !valid {
			return "MaintenanceHTTPContractError"
		}
	}
	return ""
}
