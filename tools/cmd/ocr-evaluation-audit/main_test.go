package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalQuantileKnownValues(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		probability float64
		want        float64
	}{
		{probability: 0.95, want: 1.6448536269514722},
		{probability: 0.8, want: 0.8416212335729143},
		{probability: 0.5, want: 0},
	} {
		got := normalQuantile(test.probability)
		if math.Abs(got-test.want) > 1e-8 {
			t.Fatalf("normalQuantile(%f) = %.12f, want %.12f", test.probability, got, test.want)
		}
	}
}

func TestPlanHoldoutUsesPointAndUncertaintyFloors(t *testing.T) {
	t.Parallel()
	opts := options{
		baselineCorrect:   1143,
		baselineTotal:     1152,
		marginBasisPoints: 50,
		alphaBasisPoints:  500,
		powerBasisPoints:  8000,
		fieldsPerMatch:    36,
		imagesPerMatch:    3,
	}
	plan := planHoldout(opts)
	if plan.PointEstimateFloor.RoundedMatches != 108 {
		t.Fatalf("point floor matches = %d, want 108", plan.PointEstimateFloor.RoundedMatches)
	}
	if plan.UncertaintyAwareFloor.RoundedMatches != 184 {
		t.Fatalf("uncertainty floor matches = %d, want 184", plan.UncertaintyAwareFloor.RoundedMatches)
	}
	if !plan.PairedPilotRequired || !plan.MatchClusterAdjustmentPending {
		t.Fatal("planning floors must not claim final release size")
	}
}

func TestAuditDetectsCrossDirectoryDuplicateAndDimensionViolation(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	first := filepath.Join(root, "first")
	second := filepath.Join(root, "second")
	if err := os.MkdirAll(first, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(second, 0o755); err != nil {
		t.Fatal(err)
	}
	firstImage := filepath.Join(first, "game_001_20260811_map_01assets.png")
	writePNG(t, firstImage, 1, 1)
	duplicate, err := os.ReadFile(firstImage)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(second, "game_001_20260811_map_01assets.png"), duplicate, 0o600); err != nil {
		t.Fatal(err)
	}
	writePNG(t, filepath.Join(second, "game_002_20260811_map_02revenue.png"), 3, 1)

	audit, err := auditDataset(options{
		sampleDirectories: stringList{first, second},
		maximumWidth:      2,
		maximumHeight:     2,
		requireUnique:     true,
	})
	if err != nil {
		t.Fatalf("auditDataset returned an error: %v", err)
	}
	if audit.ImageFiles != 3 || audit.UniqueContents != 2 {
		t.Fatalf("unexpected image counts: %+v", audit)
	}
	if audit.DuplicateFileReferences != 1 || audit.CrossDirectoryDuplicateGroups != 1 {
		t.Fatalf("duplicate content was not classified: %+v", audit)
	}
	if audit.OverDimensionUniqueContents != 1 || audit.Passed {
		t.Fatalf("dimension violation must fail the audit: %+v", audit)
	}
}

func TestRunEmitsMachineReadableFailureForDuplicates(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	firstImage := filepath.Join(directory, "game_001_20260811_map_01assets.png")
	writePNG(t, firstImage, 1, 1)
	content, err := os.ReadFile(firstImage)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "game_002_20260811_map_02revenue.png"), content, 0o600); err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := run([]string{
		"--samples-dir", directory,
		"--require-unique",
		"--baseline-correct", "1143",
		"--baseline-total", "1152",
	}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("duplicate audit exit code = %d, want 1; stderr=%s", exitCode, stderr.String())
	}
	var result report
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON report: %v", err)
	}
	if result.Passed || result.Dataset.DuplicateFileReferences != 1 {
		t.Fatalf("unexpected duplicate report: %+v", result)
	}
}

func TestAuditRejectsIgnoredImageUnlessExplicitlyAllowed(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	writePNG(t, filepath.Join(directory, "game_001_20260811_map_01assets.png"), 1, 1)
	writePNG(t, filepath.Join(directory, "not-an-evaluation-name.png"), 1, 1)
	opts := options{
		sampleDirectories: stringList{directory},
		maximumWidth:      2,
		maximumHeight:     2,
	}
	audit, err := auditDataset(opts)
	if err != nil {
		t.Fatalf("auditDataset returned an error: %v", err)
	}
	if audit.ImageFiles != 2 || audit.EvaluationEligibleFiles != 1 || audit.IgnoredImageFiles != 1 {
		t.Fatalf("unexpected eligibility counts: %+v", audit)
	}
	if audit.Passed {
		t.Fatal("ignored image must fail the default audit")
	}
	opts.allowIgnored = true
	audit, err = auditDataset(opts)
	if err != nil {
		t.Fatalf("auditDataset returned an error: %v", err)
	}
	if !audit.Passed {
		t.Fatalf("explicit historical-data allowance should pass: %+v", audit)
	}
}

func writePNG(t *testing.T, path string, width, height int) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	imageValue := image.NewRGBA(image.Rect(0, 0, width, height))
	imageValue.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(file, imageValue); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
