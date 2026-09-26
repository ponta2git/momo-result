package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"sort"
)

const (
	clusterBootstrapReplicates = 50_000
	clusterBootstrapSeed       = int64(2_026_081_2)
)

type baselineReport struct {
	Results []baselineImageResult `json:"results"`
}

type baselineImageResult struct {
	File         string         `json:"file"`
	MatchNo      int            `json:"match_no"`
	ScreenType   string         `json:"screen_type"`
	FieldTotal   int            `json:"field_total"`
	FieldCorrect int            `json:"field_correct"`
	Failure      *string        `json:"failure"`
	Diffs        []baselineDiff `json:"diffs"`
}

type baselineDiff struct {
	PlayOrder *int   `json:"play_order"`
	Field     string `json:"field"`
}

type pairedFieldKey struct {
	File      string
	PlayOrder int
	Field     string
}

type matchCluster struct {
	delta  int
	fields int
}

func compareWithBaseline(
	path string,
	images []imageMetadata,
	answers map[int][]expectedPlayer,
	rustResults []imageResult,
	margin float64,
) (*pairedSummary, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read baseline report: %w", err)
	}
	var baseline baselineReport
	if err := json.Unmarshal(content, &baseline); err != nil {
		return nil, fmt.Errorf("decode baseline report: %w", err)
	}
	baselineCorrect, err := baselineCorrectness(images, answers, baseline.Results)
	if err != nil {
		return nil, err
	}
	rustCorrect, matches, err := rustCorrectness(rustResults)
	if err != nil {
		return nil, err
	}
	if len(baselineCorrect) != len(rustCorrect) {
		return nil, errors.New("paired reports have different field counts")
	}
	summary := &pairedSummary{
		Fields:                     len(rustCorrect),
		ClusterBootstrapReplicates: clusterBootstrapReplicates,
		ClusterBootstrapSeed:       clusterBootstrapSeed,
		NoninferiorityMargin:       margin,
		ReleaseDecisionAllowed:     false,
		Method:                     "development_pilot_match_cluster_percentile_bootstrap_one_sided_95",
	}
	clusters := make(map[int]matchCluster)
	for _, matchNo := range matches {
		clusters[matchNo] = matchCluster{}
	}
	for key, rustIsCorrect := range rustCorrect {
		baselineIsCorrect, ok := baselineCorrect[key]
		if !ok {
			return nil, errors.New("baseline report is missing a Rust field key")
		}
		cluster := clusters[matches[key.File]]
		cluster.fields++
		switch {
		case baselineIsCorrect && rustIsCorrect:
			summary.BothCorrect++
		case baselineIsCorrect && !rustIsCorrect:
			summary.BaselineOnlyCorrect++
			cluster.delta--
		case !baselineIsCorrect && rustIsCorrect:
			summary.RustOnlyCorrect++
			cluster.delta++
		default:
			summary.BothWrong++
		}
		clusters[matches[key.File]] = cluster
	}
	for _, cluster := range clusters {
		if cluster.fields != 36 {
			return nil, errors.New("paired pilot requires complete 36-field match clusters")
		}
	}
	summary.MatchClusters = len(clusters)
	summary.Discordant = summary.BaselineOnlyCorrect + summary.RustOnlyCorrect
	summary.BaselineAccuracy = float64(summary.BothCorrect+summary.BaselineOnlyCorrect) /
		float64(summary.Fields)
	summary.RustAccuracy = float64(summary.BothCorrect+summary.RustOnlyCorrect) /
		float64(summary.Fields)
	summary.RustMinusBaseline = summary.RustAccuracy - summary.BaselineAccuracy
	lower := clusterBootstrapLower(clusters, 0.05)
	summary.ClusterBootstrapLower95 = lower
	summary.PilotNoninferioritySupported = lower != nil && *lower > -margin
	return summary, nil
}

func baselineCorrectness(
	images []imageMetadata,
	answers map[int][]expectedPlayer,
	results []baselineImageResult,
) (map[pairedFieldKey]bool, error) {
	byFile := make(map[string]baselineImageResult, len(results))
	for _, result := range results {
		if _, exists := byFile[result.File]; exists {
			return nil, errors.New("baseline report contains a duplicate image")
		}
		byFile[result.File] = result
	}
	correctness := make(map[pairedFieldKey]bool)
	for _, image := range images {
		result, ok := byFile[image.File]
		if !ok {
			return nil, errors.New("baseline report is missing an evaluated image")
		}
		if result.Failure != nil || result.MatchNo != image.MatchNo || result.ScreenType != image.ScreenType {
			return nil, errors.New("baseline image failed or does not match the selected dataset")
		}
		players, ok := answers[image.MatchNo]
		if !ok {
			return nil, errors.New("answers are missing a baseline match")
		}
		imageKeys := make(map[pairedFieldKey]bool)
		for _, player := range players {
			for _, field := range expectedFields(image.ScreenType, player) {
				key := pairedFieldKey{File: image.File, PlayOrder: player.PlayOrder, Field: field.name}
				imageKeys[key] = true
				correctness[key] = true
			}
		}
		for _, diff := range result.Diffs {
			if diff.Field == "<play_order_missed>" {
				continue
			}
			if diff.PlayOrder == nil {
				return nil, errors.New("baseline counted diff has no play order")
			}
			if diff.Field == "<player>" {
				for key := range imageKeys {
					if key.PlayOrder == *diff.PlayOrder {
						correctness[key] = false
					}
				}
				continue
			}
			key := pairedFieldKey{File: image.File, PlayOrder: *diff.PlayOrder, Field: diff.Field}
			if _, exists := imageKeys[key]; !exists {
				return nil, errors.New("baseline diff names an unknown evaluated field")
			}
			correctness[key] = false
		}
		computedCorrect := 0
		for key := range imageKeys {
			if correctness[key] {
				computedCorrect++
			}
		}
		if result.FieldTotal != len(imageKeys) || result.FieldCorrect != computedCorrect {
			return nil, errors.New("baseline aggregate disagrees with its field diffs")
		}
	}
	return correctness, nil
}

func rustCorrectness(results []imageResult) (map[pairedFieldKey]bool, map[string]int, error) {
	correctness := make(map[pairedFieldKey]bool)
	matches := make(map[string]int, len(results))
	for _, result := range results {
		matches[result.File] = result.MatchNo
		for _, outcome := range result.Outcomes {
			key := pairedFieldKey{File: result.File, PlayOrder: outcome.PlayOrder, Field: outcome.Field}
			if _, exists := correctness[key]; exists {
				return nil, nil, errors.New("Rust report contains a duplicate field")
			}
			correctness[key] = outcome.Correct
		}
	}
	return correctness, matches, nil
}

func clusterBootstrapLower(
	clusters map[int]matchCluster,
	quantile float64,
) *float64 {
	if len(clusters) < 2 {
		return nil
	}
	matchNumbers := make([]int, 0, len(clusters))
	for matchNo := range clusters {
		matchNumbers = append(matchNumbers, matchNo)
	}
	sort.Ints(matchNumbers)
	random := rand.New(rand.NewSource(clusterBootstrapSeed))
	replicates := make([]float64, clusterBootstrapReplicates)
	for replicate := range replicates {
		delta := 0
		fields := 0
		for range matchNumbers {
			selected := matchNumbers[random.Intn(len(matchNumbers))]
			delta += clusters[selected].delta
			fields += clusters[selected].fields
		}
		if fields == 0 {
			return nil
		}
		replicates[replicate] = float64(delta) / float64(fields)
	}
	sort.Float64s(replicates)
	index := int(float64(len(replicates)-1) * quantile)
	value := replicates[index]
	return &value
}
