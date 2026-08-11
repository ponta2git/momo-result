package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const (
	localSmokeEvent  = "runtime_postdeploy_smoke"
	edgeSmokeEvent   = "runtime_public_edge_smoke"
	localHTTPTimeout = 5 * time.Second
	edgeHTTPTimeout  = 10 * time.Second
	probeBodyLimit   = 131_072
)

type healthPayload struct {
	Status string `json:"status"`
}

func runLocalSmoke(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	databaseURL := os.Getenv("DATABASE_URL")
	redisURL := os.Getenv("REDIS_URL")
	originToken := os.Getenv("MOMO_ORIGIN_LOCK_TOKEN")
	host := environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost)
	edgeMode := environmentOrDefault("MOMO_POSTDEPLOY_PUBLIC_EDGE", "required")
	if databaseURL == "" || redisURL == "" || originToken == "" || validateHost(host) != nil ||
		(edgeMode != "deferred" && edgeMode != "required") {
		writeResult(stderr, failureResult(localSmokeEvent, "MissingOrInvalidConfiguration"))
		return 1
	}
	if errorClass := probeLocalHTTP(ctx, host, originToken); errorClass != "" {
		writeResult(stderr, failureResult(localSmokeEvent, errorClass))
		return 1
	}
	if edgeMode == "required" {
		if err := probePublicEdge(ctx, host); err != nil {
			writeResult(stderr, failureResult(localSmokeEvent, "PublicEdgeContractError"))
			return 1
		}
	}
	if err := probeDatabase(ctx, databaseURL); err != nil {
		writeResult(stderr, failureResult(localSmokeEvent, "DatabaseContractError"))
		return 1
	}
	if err := probeRedis(ctx, redisURL); err != nil {
		writeResult(stderr, failureResult(localSmokeEvent, "RedisContractError"))
		return 1
	}
	commandLines, err := processCommandLines()
	if err != nil {
		writeResult(stderr, failureResult(localSmokeEvent, "ProcessInspectionError"))
		return 1
	}
	missing := missingRuntimeProcesses(commandLines)
	if len(missing) != 0 {
		result := failureResult(localSmokeEvent, "MissingRuntimeProcess")
		result.MissingProcesses = missing
		writeResult(stderr, result)
		return 1
	}
	result := successResult(localSmokeEvent)
	result.Checks = localSmokeChecks(edgeMode)
	writeResult(stdout, result)
	return 0
}

func runEdgeSmoke(ctx context.Context, host string, stdout io.Writer, stderr io.Writer) int {
	if host == "" {
		host = environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost)
	}
	if err := validateHost(host); err != nil {
		writeResult(stderr, failureResult(edgeSmokeEvent, "InvalidConfiguration"))
		return 1
	}
	if err := probePublicEdge(ctx, host); err != nil {
		writeResult(stderr, failureResult(edgeSmokeEvent, "PublicEdgeContractError"))
		return 1
	}
	writeResult(stdout, successResult(edgeSmokeEvent))
	return 0
}

func probeLocalHTTP(ctx context.Context, host string, originToken string) string {
	client := &http.Client{Timeout: localHTTPTimeout}
	healthRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:8080/healthz", nil)
	if err != nil {
		return "HealthContractError"
	}
	healthRequest.Host = host
	healthRequest.Header.Set("X-Momo-Origin-Lock", originToken)
	healthResponse, err := client.Do(healthRequest)
	if err != nil {
		return "HealthContractError"
	}
	defer healthResponse.Body.Close()
	if healthResponse.StatusCode != http.StatusOK || !decodeValidHealthPayload(healthResponse.Body) {
		return "HealthContractError"
	}

	webRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:8080/", nil)
	if err != nil {
		return "WebContractError"
	}
	webRequest.Host = host
	webRequest.Header.Set("X-Momo-Origin-Lock", originToken)
	webResponse, err := client.Do(webRequest)
	if err != nil {
		return "WebContractError"
	}
	defer webResponse.Body.Close()
	body, err := io.ReadAll(io.LimitReader(webResponse.Body, probeBodyLimit))
	if err != nil || webResponse.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`<div id="root"></div>`)) {
		return "WebContractError"
	}
	return ""
}

func probePublicEdge(ctx context.Context, host string) error {
	if err := validateHost(host); err != nil {
		return err
	}
	target := url.URL{Scheme: "https", Host: host, Path: "/healthz"}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "momo-result-release-probe/1")
	response, err := (&http.Client{Timeout: edgeHTTPTimeout}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !decodeValidHealthPayload(response.Body) {
		return errors.New("public edge health contract failed")
	}
	return nil
}

func decodeValidHealthPayload(reader io.Reader) bool {
	decoder := json.NewDecoder(io.LimitReader(reader, 4096))
	var payload healthPayload
	if decoder.Decode(&payload) != nil || payload.Status != "ok" {
		return false
	}
	var trailing any
	return errors.Is(decoder.Decode(&trailing), io.EOF)
}

func probeDatabase(ctx context.Context, databaseURL string) error {
	operationCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return err
	}
	config.ConnectTimeout = 5 * time.Second
	config.RuntimeParams["application_name"] = "momo-result-postdeploy-smoke"
	connection, err := pgx.ConnectConfig(operationCtx, config)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close(context.Background()) }()
	transaction, err := connection.BeginTx(operationCtx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	if _, err := transaction.Exec(operationCtx, "SET LOCAL statement_timeout = 5000"); err != nil {
		return err
	}
	var value int
	if err := transaction.QueryRow(operationCtx, "SELECT 1").Scan(&value); err != nil {
		return err
	}
	if value != 1 {
		return errors.New("database health contract failed")
	}
	return nil
}

func probeRedis(ctx context.Context, redisURL string) error {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return err
	}
	options.DialTimeout = 5 * time.Second
	options.ReadTimeout = 5 * time.Second
	options.WriteTimeout = 5 * time.Second
	options.ContextTimeoutEnabled = true
	client := redis.NewClient(options)
	defer client.Close()
	operationCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return client.Ping(operationCtx).Err()
}

func localSmokeChecks(edgeMode string) []string {
	checks := []string{"database", "http", "processes"}
	if edgeMode == "required" {
		checks = append(checks, "publicEdge")
	}
	return append(checks, "redis", "web")
}
