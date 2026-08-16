package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const (
	localSmokeEvent  = "runtime_postdeploy_smoke"
	edgeSmokeEvent   = "runtime_public_edge_smoke"
	http2SmokeEvent  = "runtime_http2_smoke"
	localHTTPTimeout = 5 * time.Second
	edgeHTTPTimeout  = 10 * time.Second
	probeBodyLimit   = 131_072
	http2ProbePath   = "/api/__momo_runtime/http2-probe"
	http2ProbeCount  = 16
)

type healthPayload struct {
	Status string `json:"status"`
}

type http2ProbePayload struct {
	HTTPVersion string `json:"httpVersion"`
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
	if err := probeLocalHTTP2(ctx, host, originToken); err != nil {
		writeResult(stderr, failureResult(localSmokeEvent, "HTTP2ContractError"))
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

func runHTTP2Smoke(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	originToken := os.Getenv("MOMO_ORIGIN_LOCK_TOKEN")
	host := environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost)
	if originToken == "" || validateHost(host) != nil {
		writeResult(stderr, failureResult(http2SmokeEvent, "MissingOrInvalidConfiguration"))
		return 1
	}
	if err := probeLocalHTTP2(ctx, host, originToken); err != nil {
		writeResult(stderr, failureResult(http2SmokeEvent, "HTTP2ContractError"))
		return 1
	}
	writeResult(stdout, successResult(http2SmokeEvent))
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

func probeLocalHTTP2(ctx context.Context, host string, originToken string) error {
	if err := probePublicListenerH2C(ctx, host, originToken); err != nil {
		return err
	}
	return probeUpstreamMultiplexing(ctx, host, originToken)
}

func probePublicListenerH2C(ctx context.Context, host string, originToken string) error {
	protocols := new(http.Protocols)
	protocols.SetUnencryptedHTTP2(true)
	transport := &http.Transport{Protocols: protocols}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: localHTTPTimeout, Transport: transport}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:8080/healthz", nil)
	if err != nil {
		return err
	}
	request.Host = host
	request.Header.Set("X-Momo-Origin-Lock", originToken)
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.ProtoMajor != 2 || response.StatusCode != http.StatusOK ||
		!decodeValidHealthPayload(response.Body) {
		return errors.New("public listener HTTP/2 contract failed")
	}
	return nil
}

func probeUpstreamMultiplexing(ctx context.Context, host string, originToken string) error {
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	transport := &http.Transport{
		Protocols:           protocols,
		MaxConnsPerHost:     http2ProbeCount,
		MaxIdleConnsPerHost: http2ProbeCount,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: localHTTPTimeout, Transport: transport}

	if _, err := requestHTTP2Probe(ctx, client, host, originToken); err != nil {
		return err
	}
	steadyConnections, err := establishedTCPConnectionsOnLocalPort(8081)
	if err != nil {
		return err
	}
	if steadyConnections < 1 {
		return errors.New("upstream HTTP/2 connection was not observable")
	}

	started := time.Now()
	results := make(chan http2ProbePayload, http2ProbeCount)
	failures := make(chan error, http2ProbeCount)
	startRequests := make(chan struct{})
	var waitGroup sync.WaitGroup
	waitGroup.Add(http2ProbeCount)
	for range http2ProbeCount {
		go func() {
			defer waitGroup.Done()
			<-startRequests
			payload, requestErr := requestHTTP2Probe(ctx, client, host, originToken)
			if requestErr != nil {
				failures <- requestErr
				return
			}
			results <- payload
		}()
	}
	requestsDone := make(chan struct{})
	go func() {
		waitGroup.Wait()
		close(requestsDone)
	}()
	maximumConnections := steadyConnections
	monitorTicker := time.NewTicker(10 * time.Millisecond)
	close(startRequests)
	var monitorError error
monitorLoop:
	for {
		select {
		case <-requestsDone:
			break monitorLoop
		case <-monitorTicker.C:
			connectionCount, countErr := establishedTCPConnectionsOnLocalPort(8081)
			if countErr != nil {
				monitorError = countErr
				<-requestsDone
				break monitorLoop
			}
			if connectionCount > maximumConnections {
				maximumConnections = connectionCount
			}
		}
	}
	monitorTicker.Stop()
	if monitorError == nil {
		connectionCount, countErr := establishedTCPConnectionsOnLocalPort(8081)
		if countErr != nil {
			monitorError = countErr
		} else if connectionCount > maximumConnections {
			maximumConnections = connectionCount
		}
	}
	close(results)
	close(failures)
	if monitorError != nil {
		return monitorError
	}
	if len(failures) != 0 {
		return <-failures
	}
	for payload := range results {
		if payload.HTTPVersion != "HTTP/2.0" {
			return errors.New("upstream requests did not reach the API over HTTP/2")
		}
	}
	if maximumConnections != steadyConnections {
		return errors.New("concurrent upstream requests opened additional API connections")
	}
	if time.Since(started) >= 2*time.Second {
		return errors.New("upstream HTTP/2 probe did not complete concurrently")
	}
	return nil
}

func requestHTTP2Probe(
	ctx context.Context,
	client *http.Client,
	host string,
	originToken string,
) (http2ProbePayload, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://127.0.0.1:8080"+http2ProbePath,
		nil,
	)
	if err != nil {
		return http2ProbePayload{}, err
	}
	request.Host = host
	request.Header.Set("X-Momo-Origin-Lock", originToken)
	response, err := client.Do(request)
	if err != nil {
		return http2ProbePayload{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return http2ProbePayload{}, errors.New("upstream HTTP/2 probe returned an unexpected status")
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4096))
	var payload http2ProbePayload
	if decoder.Decode(&payload) != nil || payload.HTTPVersion != "HTTP/2.0" {
		return http2ProbePayload{}, errors.New("upstream HTTP/2 probe returned an invalid payload")
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		return http2ProbePayload{}, errors.New("upstream HTTP/2 probe returned trailing data")
	}
	return payload, nil
}

func establishedTCPConnectionsOnLocalPort(port int) (int, error) {
	if port < 1 || port > 65535 {
		return 0, errors.New("invalid TCP port")
	}
	paths := []string{"/proc/net/tcp", "/proc/net/tcp6"}
	total := 0
	observedProcFile := false
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return 0, err
		}
		observedProcFile = true
		count, countErr := countEstablishedTCPConnections(bufio.NewScanner(file), port)
		closeErr := file.Close()
		if countErr != nil {
			return 0, countErr
		}
		if closeErr != nil {
			return 0, closeErr
		}
		total += count
	}
	if !observedProcFile {
		return 0, errors.New("TCP connection state is unavailable")
	}
	return total, nil
}

func countEstablishedTCPConnections(scanner *bufio.Scanner, port int) (int, error) {
	count := 0
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 || fields[0] == "sl" {
			continue
		}
		if len(fields) < 4 {
			return 0, errors.New("invalid TCP connection row")
		}
		separator := strings.LastIndexByte(fields[1], ':')
		if separator < 0 || separator == len(fields[1])-1 {
			return 0, errors.New("invalid local TCP address")
		}
		localPort, err := strconv.ParseUint(fields[1][separator+1:], 16, 16)
		if err != nil {
			return 0, errors.New("invalid local TCP port")
		}
		if int(localPort) == port && fields[3] == "01" {
			count++
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	return count, nil
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
	checks := []string{"database", "http", "http2", "processes"}
	if edgeMode == "required" {
		checks = append(checks, "publicEdge")
	}
	return append(checks, "redis", "web")
}
