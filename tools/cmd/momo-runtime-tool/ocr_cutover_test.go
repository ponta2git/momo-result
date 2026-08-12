package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestOCRV1CutoverDrainDecision(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name     string
		snapshot ocrV1CutoverSnapshot
		drained  bool
	}{
		{name: "never-created stream", drained: true},
		{
			name: "acknowledged historical entries",
			snapshot: ocrV1CutoverSnapshot{
				StreamLength:         42,
				ConsumerGroupPresent: true,
			},
			drained: true,
		},
		{
			name: "undelivered outbox",
			snapshot: ocrV1CutoverSnapshot{
				OutboxNotDelivered: 1,
			},
		},
		{
			name: "active database job",
			snapshot: ocrV1CutoverSnapshot{
				JobsActive: 1,
			},
		},
		{
			name: "stream without expected group",
			snapshot: ocrV1CutoverSnapshot{
				StreamLength: 1,
			},
		},
		{
			name: "pending delivery",
			snapshot: ocrV1CutoverSnapshot{
				ConsumerGroupPresent: true,
				ConsumerGroupPending: 1,
			},
		},
		{
			name: "undelivered group lag",
			snapshot: ocrV1CutoverSnapshot{
				ConsumerGroupPresent: true,
				ConsumerGroupLag:     1,
			},
		},
		{
			name: "indeterminate group lag",
			snapshot: ocrV1CutoverSnapshot{
				ConsumerGroupPresent: true,
				ConsumerGroupLag:     -1,
			},
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if actual := testCase.snapshot.drained(); actual != testCase.drained {
				t.Fatalf("drained = %v, want %v", actual, testCase.drained)
			}
		})
	}
}

func TestOCRCutoverAuditRejectsMissingURLsWithoutLeakingValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runOCRCutoverAudit(
		context.Background(), []string{"--require-v1-drained"}, &stdout, &stderr,
	)
	if exitCode != 1 || stdout.Len() != 0 {
		t.Fatalf("exit=%d stdout=%s", exitCode, stdout.String())
	}
	var result ocrCutoverAuditResult
	if err := json.Unmarshal(stderr.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ErrorClass != "MissingDependencyUrl" || result.Status != "failed" {
		t.Fatalf("result = %#v", result)
	}
}

func TestOCRCutoverAuditRejectsInvalidArguments(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runOCRCutoverAudit(
		context.Background(), []string{"--unknown"}, &stdout, &stderr,
	)
	if exitCode != 2 || stdout.Len() != 0 {
		t.Fatalf("exit=%d stdout=%s", exitCode, stdout.String())
	}
	if !strings.Contains(stderr.String(), `"errorClass":"InvalidArguments"`) {
		t.Fatalf("stderr = %s", stderr.String())
	}
}
