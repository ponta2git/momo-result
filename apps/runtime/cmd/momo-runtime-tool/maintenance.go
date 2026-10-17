package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
)

type maintenanceMode string

const (
	maintenanceNormal        maintenanceMode = "normal"
	maintenanceFrozen        maintenanceMode = "frozen"
	maintenanceSmokeEvent                    = "runtime_maintenance_readiness"
	maintenanceReadinessPath                 = "/api/__momo_runtime/maintenance-readiness"
)

func maintenanceModeFromEnvironment() (maintenanceMode, error) {
	value, present := os.LookupEnv("MOMO_MAINTENANCE_MODE")
	return parseMaintenanceMode(value, present)
}

func parseMaintenanceMode(value string, present bool) (maintenanceMode, error) {
	if !present || value == string(maintenanceNormal) {
		return maintenanceNormal, nil
	}
	if value == string(maintenanceFrozen) {
		return maintenanceFrozen, nil
	}
	return "", errors.New("invalid maintenance mode")
}

// Maintenance readiness is deliberately distinct from normal post-deploy success.
func runMaintenanceSmoke(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	databaseURL := os.Getenv("DATABASE_URL")
	originToken := os.Getenv("MOMO_ORIGIN_LOCK_TOKEN")
	host := environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost)
	if databaseURL == "" || originToken == "" || validateHost(host) != nil {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "MissingOrInvalidConfiguration"))
		return 1
	}
	client := newProbeHTTPClient(localHTTPTimeout, nil)
	if err := probeMaintenanceHTTP(ctx, client, "http://127.0.0.1:8080", host, originToken); err != nil {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "MaintenanceHTTPContractError"))
		return 1
	}
	contractPath := environmentOrDefault("MOMO_RUNTIME_DB_CONTRACT_PATH", defaultDBContractPath)
	contract, err := loadRuntimeDBContract(contractPath)
	if err != nil {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "ContractLoadError"))
		return 1
	}
	operationCtx, cancel := context.WithTimeout(ctx, preflightOperationTimeout)
	defer cancel()
	snapshot, err := inspectRuntimeDatabase(operationCtx, databaseURL)
	if err != nil || hasMissing(missingContractCounts(contract, snapshot)) {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "DatabaseContractError"))
		return 1
	}
	commandLines, err := processCommandLines()
	if err != nil || len(missingRuntimeProcesses(commandLines)) != 0 {
		writeResult(stderr, failureResult(maintenanceSmokeEvent, "ProcessInspectionError"))
		return 1
	}
	result := successResult(maintenanceSmokeEvent)
	result.Checks = []string{"frozen_readiness", "normal_routes_closed", "database_contract", "runtime_processes"}
	writeResult(stdout, result)
	return 0
}

func probeMaintenanceHTTP(ctx context.Context, client *http.Client, baseURL, host, originToken string) error {
	for _, probe := range []struct {
		method string
		path   string
		code   int
		status string
	}{
		{http.MethodGet, maintenanceReadinessPath, http.StatusOK, "ready"},
		{http.MethodGet, "/healthz", http.StatusOK, "maintenance"},
		{http.MethodGet, "/api/auth/me", http.StatusServiceUnavailable, "maintenance"},
		{http.MethodPost, "/api/ocr/jobs", http.StatusServiceUnavailable, "maintenance"},
	} {
		request, err := http.NewRequestWithContext(ctx, probe.method, baseURL+probe.path, nil)
		if err != nil {
			return err
		}
		request.Host = host
		request.Header.Set("X-Momo-Origin-Lock", originToken)
		response, err := client.Do(request)
		if err != nil {
			return err
		}
		valid := response.StatusCode == probe.code && decodeMaintenancePayload(response.Body, probe.status)
		_ = response.Body.Close()
		if !valid {
			return errors.New("maintenance HTTP contract mismatch")
		}
	}
	return nil
}

func decodeMaintenancePayload(reader io.Reader, expectedStatus string) bool {
	var payload struct {
		Status string `json:"status"`
		Mode   string `json:"mode"`
	}
	encoded, err := io.ReadAll(io.LimitReader(reader, probeBodyLimit+1))
	if err != nil || len(encoded) > probeBodyLimit {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&payload) != nil || payload.Status != expectedStatus || payload.Mode != string(maintenanceFrozen) {
		return false
	}
	return decoder.Decode(new(any)) == io.EOF
}
