package main

import (
	"math"
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
	}, expected, envelope, 10, nil)
	if result.FieldTotal != 2 || result.FieldCorrect != 2 {
		t.Fatalf("unexpected field score: %+v", result)
	}
	if result.PlayerOrder.DirectMatches != 1 {
		t.Fatalf("unexpected order diagnostics: %+v", result.PlayerOrder)
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
		1: {delta: 1, fields: 36},
		2: {delta: -1, fields: 36},
		3: {delta: 2, fields: 36},
	}
	first := clusterBootstrapLower(clusters, 0.05)
	second := clusterBootstrapLower(clusters, 0.05)
	if first == nil || second == nil || *first != *second {
		t.Fatalf("bootstrap must be deterministic: first=%v second=%v", first, second)
	}
	if math.IsNaN(*first) || *first < -1 || *first > 1 {
		t.Fatalf("bootstrap lower bound is invalid: %f", *first)
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
