package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func integer(value int64) *int64 {
	return &value
}

func TestEvaluateImageCountsTheExactScreenFields(t *testing.T) {
	t.Parallel()
	expected := []expectedPlayer{{
		PlayOrder:   1,
		Name:        "ぽんた",
		Rank:        integer(2),
		TotalAssets: integer(4560),
		Incidents:   map[string]int64{},
	}}
	var envelope pilotEnvelope
	order := int64(1)
	name := "ぽんた社長"
	rank := int64(2)
	total := int64(4560)
	envelope.DetectedScreenType = "total_assets"
	envelope.Result.Players = []pilotPlayer{{
		RawPlayerName:     ocrField[string]{Value: &name},
		PlayOrder:         ocrField[int64]{Value: &order},
		Rank:              ocrField[int64]{Value: &rank},
		TotalAssetsManYen: ocrField[int64]{Value: &total},
	}}
	result := evaluateImage(imageMetadata{
		File: "sample.png", MatchNo: 1, ScreenType: "total_assets",
	}, expected, envelope, processResourceMetrics{WallMilliseconds: 10}, nil)
	if result.FieldTotal != 2 || result.FieldCorrect != 2 {
		t.Fatalf("unexpected field score: %+v", result)
	}
	if result.PlayerOrder.DirectMatches != 1 {
		t.Fatalf("unexpected order diagnostics: %+v", result.PlayerOrder)
	}
}

func TestSummarizeBytesUsesDeterministicInterpolatedPercentiles(t *testing.T) {
	t.Parallel()
	summary := summarizeBytes([]uint64{100, 400, 200, 300})
	if summary.Count != 4 || summary.Min != 100 || summary.Max != 400 {
		t.Fatalf("unexpected byte bounds: %+v", summary)
	}
	if summary.P50 != 250 || summary.P95 != 385 || summary.P99 != 397 {
		t.Fatalf("unexpected byte percentiles: %+v", summary)
	}
}

func TestResolvePlayerUsesTheSameNameFallbackVocabulary(t *testing.T) {
	t.Parallel()
	name := "ＮＯ１１社長"
	players := []pilotPlayer{{RawPlayerName: ocrField[string]{Value: &name}}}
	resolved, kind := resolvePlayer(players, expectedPlayer{Name: "あかねまみ", PlayOrder: 1})
	if resolved == nil || kind != "name" {
		t.Fatalf("fallback resolution failed: resolved=%v kind=%s", resolved, kind)
	}
}

func TestClusterBootstrapIsDeterministicAndUsesWholeMatches(t *testing.T) {
	t.Parallel()
	clusters := map[int]matchCluster{
		1: {delta: 18, fields: 36},
		2: {delta: -18, fields: 36},
	}
	first := clusterBootstrapLower(clusters, 0.05)
	second := clusterBootstrapLower(clusters, 0.05)
	if first == nil || second == nil || *first != *second {
		t.Fatalf("bootstrap must be deterministic: first=%v second=%v", first, second)
	}
	// Resampling two whole matches yields only -0.5, 0, or 0.5. The lower
	// quarter of the distribution consists of two draws of the losing match.
	if *first != -0.5 {
		t.Fatalf("whole-match lower bound = %f, want -0.5", *first)
	}
}

func TestPairedComparisonRequiresOneOfEachScreenPerMatch(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		screens []string
		valid   bool
	}{
		{name: "complete", screens: []string{"total_assets", "revenue", "incident_log"}, valid: true},
		{name: "repeated_revenue", screens: []string{"revenue", "revenue", "revenue", "revenue", "revenue", "revenue", "revenue", "revenue", "revenue"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			answers := make(map[int][]expectedPlayer)
			var images []imageMetadata
			var rustResults []imageResult
			var baseline baselineReport
			for match := 1; match <= 2; match++ {
				for order := 1; order <= 4; order++ {
					answers[match] = append(answers[match], expectedPlayer{PlayOrder: order})
				}
				for index, screen := range test.screens {
					file := fmt.Sprintf("match-%d-image-%d.png", match, index)
					images = append(images, imageMetadata{File: file, MatchNo: match, ScreenType: screen})
					result := imageResult{File: file, MatchNo: match, ScreenType: screen}
					for _, player := range answers[match] {
						for _, field := range expectedFields(screen, player) {
							result.Outcomes = append(result.Outcomes, fieldOutcome{PlayOrder: player.PlayOrder, Field: field.name, Correct: true})
						}
					}
					rustResults = append(rustResults, result)
					baseline.Results = append(baseline.Results, baselineImageResult{
						File: file, MatchNo: match, ScreenType: screen,
						FieldTotal: len(result.Outcomes), FieldCorrect: len(result.Outcomes),
					})
				}
			}
			content, err := json.Marshal(baseline)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "baseline.json")
			if err := os.WriteFile(path, content, 0o600); err != nil {
				t.Fatal(err)
			}
			summary, err := compareWithBaseline(path, images, answers, rustResults, 0.005)
			if !test.valid {
				if err == nil {
					t.Fatal("36 fields from a repeated screen must not establish paired noninferiority")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if summary.Fields != 72 || summary.MatchClusters != 2 || summary.BothCorrect != 72 ||
				!summary.PilotNoninferioritySupported || summary.ReleaseDecisionAllowed {
				t.Fatalf("unexpected complete-pilot comparison: %+v", summary)
			}
		})
	}
}

func TestSampleFilenameRequiresAnExplicitSupportedScreenPrefix(t *testing.T) {
	t.Parallel()
	valid := "桃鉄2_007_20251121_西日本_03事件簿_note.jpg"
	if !sampleFilenamePattern.MatchString(valid) {
		t.Fatal("valid evaluator filename was rejected")
	}
	invalid := "桃鉄2_007_20251121_西日本_00auto.jpg"
	if sampleFilenamePattern.MatchString(invalid) {
		t.Fatal("auto-like filename must not enter the evaluator")
	}
}
