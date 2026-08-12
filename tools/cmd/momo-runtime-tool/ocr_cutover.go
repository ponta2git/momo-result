package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const (
	ocrCutoverAuditEvent      = "ocr_v1_cutover_audit"
	defaultOCRV1Stream        = "momo:ocr:jobs"
	defaultOCRV1ConsumerGroup = "momo-ocr-workers"
	ocrCutoverAuditTimeout    = 20 * time.Second
	ocrCutoverConnectTimeout  = 5 * time.Second
)

type ocrV1CutoverSnapshot struct {
	OutboxNotDelivered   int64 `json:"outboxNotDelivered"`
	OutboxPending        int64 `json:"outboxPending"`
	OutboxInFlight       int64 `json:"outboxInFlight"`
	OutboxFailed         int64 `json:"outboxFailed"`
	JobsActive           int64 `json:"jobsActive"`
	JobsQueued           int64 `json:"jobsQueued"`
	JobsRunning          int64 `json:"jobsRunning"`
	StreamLength         int64 `json:"streamLength"`
	ConsumerGroupPresent bool  `json:"consumerGroupPresent"`
	ConsumerGroupPending int64 `json:"consumerGroupPending"`
	ConsumerGroupLag     int64 `json:"consumerGroupLag"`
}

func (snapshot ocrV1CutoverSnapshot) drained() bool {
	if snapshot.OutboxNotDelivered != 0 || snapshot.JobsActive != 0 {
		return false
	}
	if !snapshot.ConsumerGroupPresent {
		return snapshot.StreamLength == 0
	}
	return snapshot.ConsumerGroupPending == 0 && snapshot.ConsumerGroupLag == 0
}

type ocrCutoverAuditResult struct {
	Event         string                `json:"event"`
	SchemaVersion int                   `json:"schemaVersion,omitempty"`
	Status        string                `json:"status"`
	Drained       bool                  `json:"drained"`
	Snapshot      *ocrV1CutoverSnapshot `json:"snapshot,omitempty"`
	ErrorClass    string                `json:"errorClass,omitempty"`
}

func runOCRCutoverAudit(
	ctx context.Context,
	args []string,
	stdout io.Writer,
	stderr io.Writer,
) int {
	requireDrained := false
	switch {
	case len(args) == 0:
	case len(args) == 1 && args[0] == "--require-v1-drained":
		requireDrained = true
	default:
		writeOCRCutoverResult(stderr, failedOCRCutoverResult("InvalidArguments"))
		return 2
	}

	databaseURL := os.Getenv("DATABASE_URL")
	redisURL := os.Getenv("REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		writeOCRCutoverResult(stderr, failedOCRCutoverResult("MissingDependencyUrl"))
		return 1
	}
	stream := environmentOrDefault("OCR_REDIS_STREAM", defaultOCRV1Stream)
	group := environmentOrDefault("OCR_REDIS_GROUP", defaultOCRV1ConsumerGroup)

	operationCtx, cancel := context.WithTimeout(ctx, ocrCutoverAuditTimeout)
	defer cancel()
	snapshot, err := inspectOCRV1Database(operationCtx, databaseURL)
	if err != nil {
		writeOCRCutoverResult(stderr, failedOCRCutoverResult("DatabaseProbeError"))
		return 1
	}
	if err := inspectOCRV1Stream(operationCtx, redisURL, stream, group, &snapshot); err != nil {
		writeOCRCutoverResult(stderr, failedOCRCutoverResult("RedisProbeError"))
		return 1
	}

	result := ocrCutoverAuditResult{
		Event:         ocrCutoverAuditEvent,
		SchemaVersion: resultSchemaVersion,
		Status:        "ok",
		Drained:       snapshot.drained(),
		Snapshot:      &snapshot,
	}
	if requireDrained && !result.Drained {
		result.Status = "failed"
		result.ErrorClass = "V1NotDrained"
		writeOCRCutoverResult(stderr, result)
		return 1
	}
	writeOCRCutoverResult(stdout, result)
	return 0
}

func inspectOCRV1Database(
	ctx context.Context,
	databaseURL string,
) (ocrV1CutoverSnapshot, error) {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return ocrV1CutoverSnapshot{}, err
	}
	config.ConnectTimeout = ocrCutoverConnectTimeout
	config.RuntimeParams["application_name"] = "momo-result-ocr-cutover-audit"
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return ocrV1CutoverSnapshot{}, err
	}
	defer func() { _ = connection.Close(context.Background()) }()

	transaction, err := connection.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return ocrV1CutoverSnapshot{}, err
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	if _, err := transaction.Exec(ctx, "SET LOCAL statement_timeout = 10000"); err != nil {
		return ocrV1CutoverSnapshot{}, err
	}
	if _, err := transaction.Exec(ctx, "SET LOCAL lock_timeout = 3000"); err != nil {
		return ocrV1CutoverSnapshot{}, err
	}

	var snapshot ocrV1CutoverSnapshot
	err = transaction.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM ocr_queue_outbox
			 WHERE schema_version = 1 AND status <> 'DELIVERED'),
			(SELECT COUNT(*) FROM ocr_queue_outbox
			 WHERE schema_version = 1 AND status = 'PENDING'),
			(SELECT COUNT(*) FROM ocr_queue_outbox
			 WHERE schema_version = 1 AND status = 'IN_FLIGHT'),
			(SELECT COUNT(*) FROM ocr_queue_outbox
			 WHERE schema_version = 1 AND status = 'FAILED'),
			(SELECT COUNT(*) FROM ocr_jobs
			 WHERE queue_schema_version = 1 AND status IN ('queued', 'running')),
			(SELECT COUNT(*) FROM ocr_jobs
			 WHERE queue_schema_version = 1 AND status = 'queued'),
			(SELECT COUNT(*) FROM ocr_jobs
			 WHERE queue_schema_version = 1 AND status = 'running')
	`).Scan(
		&snapshot.OutboxNotDelivered,
		&snapshot.OutboxPending,
		&snapshot.OutboxInFlight,
		&snapshot.OutboxFailed,
		&snapshot.JobsActive,
		&snapshot.JobsQueued,
		&snapshot.JobsRunning,
	)
	if err != nil {
		return ocrV1CutoverSnapshot{}, err
	}
	return snapshot, nil
}

func inspectOCRV1Stream(
	ctx context.Context,
	redisURL string,
	stream string,
	group string,
	snapshot *ocrV1CutoverSnapshot,
) error {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return err
	}
	options.DialTimeout = ocrCutoverConnectTimeout
	options.ReadTimeout = ocrCutoverConnectTimeout
	client := redis.NewClient(options)
	defer func() { _ = client.Close() }()

	streamLength, err := client.XLen(ctx, stream).Result()
	if err != nil {
		return err
	}
	snapshot.StreamLength = streamLength
	groups, err := client.XInfoGroups(ctx, stream).Result()
	if err != nil {
		if streamLength == 0 && redis.HasErrorPrefix(err, "ERR no such key") {
			return nil
		}
		return err
	}
	for _, candidate := range groups {
		if candidate.Name == group {
			snapshot.ConsumerGroupPresent = true
			snapshot.ConsumerGroupPending = candidate.Pending
			snapshot.ConsumerGroupLag = candidate.Lag
			return nil
		}
	}
	return nil
}

func failedOCRCutoverResult(errorClass string) ocrCutoverAuditResult {
	return ocrCutoverAuditResult{
		Event:      ocrCutoverAuditEvent,
		Status:     "failed",
		ErrorClass: errorClass,
	}
}

func writeOCRCutoverResult(destination io.Writer, result ocrCutoverAuditResult) {
	encoder := json.NewEncoder(destination)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(result)
}
