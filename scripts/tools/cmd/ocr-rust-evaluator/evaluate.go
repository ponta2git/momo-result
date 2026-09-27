package main

import (
	"math"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var expectedNameFragments = map[string][]string{
	"おーたか":  {"おーたか", "おたか", "オータカ", "オタカ", "オー夕カ"},
	"いーゆー":  {"いーゆー", "いーゆ", "イーユー", "イーユ"},
	"ぽんた":   {"ぽんた", "ほんた", "ぼんた", "ポンタ"},
	"あかねまみ": {"あかねまみ", "アカネマミ", "no11", "ＮＯ１１"},
	"さくま":   {"さくま", "サクマ"},
}

func evaluateImage(
	metadata imageMetadata,
	expected []expectedPlayer,
	envelope pilotEnvelope,
	resources processResourceMetrics,
	pilotError error,
) imageResult {
	result := imageResult{
		File:                 metadata.File,
		MatchNo:              metadata.MatchNo,
		ScreenType:           metadata.ScreenType,
		DurationMilliseconds: resources.WallMilliseconds,
		ProcessResources:     resources,
		Outcomes:             make([]fieldOutcome, 0, expectedFieldCount(metadata.ScreenType)),
	}
	if pilotError != nil {
		failure := pilotError.Error()
		result.Failure = &failure
		result.Outcomes = missingOutcomes(metadata.ScreenType, expected)
		finalizeImageResult(&result)
		return result
	}
	result.DetectedScreenType = envelope.DetectedScreenType
	result.ProfileID = envelope.ProfileID
	result.WarningCount = len(envelope.Warnings)
	if coreDuration, ok := envelope.TimingsMilliseconds["total"]; ok {
		result.CoreDurationMilliseconds = &coreDuration
	}
	for _, expectedPlayer := range expected {
		predicted, matchKind := resolvePlayer(envelope.Result.Players, expectedPlayer)
		result.PlayerOrder.DirectTotal++
		switch matchKind {
		case "play_order":
			result.PlayerOrder.DirectMatches++
		case "name":
			result.PlayerOrder.FallbackNameMatches++
		default:
			result.PlayerOrder.UnresolvedPlayers++
		}
		result.Outcomes = append(
			result.Outcomes,
			comparePlayer(metadata.ScreenType, expectedPlayer, predicted)...,
		)
	}
	finalizeImageResult(&result)
	return result
}

func comparePlayer(screenType string, expected expectedPlayer, predicted *pilotPlayer) []fieldOutcome {
	fields := expectedFields(screenType, expected)
	outcomes := make([]fieldOutcome, 0, len(fields))
	for _, field := range fields {
		var got *int64
		if predicted != nil {
			got = predictedValue(*predicted, field.name)
		}
		outcomes = append(outcomes, fieldOutcome{
			PlayOrder: expected.PlayOrder,
			Field:     field.name,
			Correct:   predicted != nil && equalOptionalInteger(field.expected, got),
			Expected:  field.expected,
			Got:       got,
		})
	}
	return outcomes
}

type expectedField struct {
	name     string
	expected *int64
}

func expectedFields(screenType string, player expectedPlayer) []expectedField {
	switch screenType {
	case "total_assets":
		return []expectedField{
			{name: "rank", expected: player.Rank},
			{name: "total_assets", expected: player.TotalAssets},
		}
	case "revenue":
		return []expectedField{{name: "revenue", expected: player.Revenue}}
	case "incident_log":
		fields := make([]expectedField, 0, len(incidentFields))
		for _, name := range incidentFields {
			value := player.Incidents[name]
			valueCopy := value
			fields = append(fields, expectedField{name: name, expected: &valueCopy})
		}
		return fields
	default:
		return nil
	}
}

func predictedValue(player pilotPlayer, field string) *int64 {
	switch field {
	case "rank":
		return player.Rank.Value
	case "total_assets":
		return player.TotalAssetsManYen.Value
	case "revenue":
		return player.RevenueManYen.Value
	default:
		incident, ok := player.Incidents[field]
		if !ok {
			return nil
		}
		return incident.Value
	}
}

func resolvePlayer(players []pilotPlayer, expected expectedPlayer) (*pilotPlayer, string) {
	for index := range players {
		if players[index].PlayOrder.Value != nil && *players[index].PlayOrder.Value == int64(expected.PlayOrder) {
			return &players[index], "play_order"
		}
	}
	fragments := expectedNameFragments[expected.Name]
	if len(fragments) == 0 {
		fragments = []string{expected.Name}
	}
	normalizedFragments := make([]string, 0, len(fragments))
	for _, fragment := range fragments {
		normalizedFragments = append(normalizedFragments, normalizeName(fragment))
	}
	for index := range players {
		if players[index].RawPlayerName.Value == nil {
			continue
		}
		raw := normalizeName(*players[index].RawPlayerName.Value)
		for _, fragment := range normalizedFragments {
			if fragment != "" && strings.Contains(raw, fragment) {
				return &players[index], "name"
			}
		}
	}
	return nil, "none"
}

func normalizeName(value string) string {
	normalized := strings.ToLower(norm.NFKC.String(value))
	normalized = strings.ReplaceAll(normalized, "社長", "")
	normalized = strings.ReplaceAll(normalized, "さん", "")
	return strings.Map(func(character rune) rune {
		if unicode.IsSpace(character) {
			return -1
		}
		return character
	}, normalized)
}

func equalOptionalInteger(left, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func missingOutcomes(screenType string, expected []expectedPlayer) []fieldOutcome {
	outcomes := make([]fieldOutcome, 0, expectedFieldCount(screenType))
	for _, player := range expected {
		outcomes = append(outcomes, comparePlayer(screenType, player, nil)...)
	}
	return outcomes
}

func expectedFieldCount(screenType string) int {
	switch screenType {
	case "total_assets":
		return 8
	case "revenue":
		return 4
	case "incident_log":
		return 24
	default:
		return 0
	}
}

func finalizeImageResult(result *imageResult) {
	result.FieldTotal = len(result.Outcomes)
	for _, outcome := range result.Outcomes {
		if outcome.Correct {
			result.FieldCorrect++
		}
	}
	if result.PlayerOrder.DirectTotal > 0 {
		result.PlayerOrder.DirectAccuracy = float64(result.PlayerOrder.DirectMatches) /
			float64(result.PlayerOrder.DirectTotal)
	}
}

func summarize(results []imageResult) evaluationSummary {
	summary := evaluationSummary{
		Images:       len(results),
		ByScreenType: make(map[string]accuracyBucket),
	}
	durations := make([]float64, 0, len(results))
	userCPU := make([]float64, 0, len(results))
	systemCPU := make([]float64, 0, len(results))
	maximumRSS := make([]uint64, 0, len(results))
	for _, result := range results {
		summary.FieldsTotal += result.FieldTotal
		summary.FieldsCorrect += result.FieldCorrect
		bucket := summary.ByScreenType[result.ScreenType]
		bucket.Images++
		bucket.Total += result.FieldTotal
		bucket.Correct += result.FieldCorrect
		summary.ByScreenType[result.ScreenType] = bucket
		summary.PlayerOrder.DirectTotal += result.PlayerOrder.DirectTotal
		summary.PlayerOrder.DirectMatches += result.PlayerOrder.DirectMatches
		summary.PlayerOrder.FallbackNameMatches += result.PlayerOrder.FallbackNameMatches
		summary.PlayerOrder.UnresolvedPlayers += result.PlayerOrder.UnresolvedPlayers
		if result.Failure != nil {
			summary.Failures++
		} else {
			durations = append(durations, result.DurationMilliseconds)
			userCPU = append(userCPU, result.ProcessResources.UserCPUMilliseconds)
			systemCPU = append(systemCPU, result.ProcessResources.SystemCPUMilliseconds)
			if result.ProcessResources.MaximumResidentBytes != nil {
				maximumRSS = append(maximumRSS, *result.ProcessResources.MaximumResidentBytes)
			}
		}
	}
	if summary.FieldsTotal > 0 {
		summary.Accuracy = float64(summary.FieldsCorrect) / float64(summary.FieldsTotal)
	}
	for screenType, bucket := range summary.ByScreenType {
		if bucket.Total > 0 {
			bucket.Accuracy = float64(bucket.Correct) / float64(bucket.Total)
		}
		summary.ByScreenType[screenType] = bucket
	}
	if summary.PlayerOrder.DirectTotal > 0 {
		summary.PlayerOrder.DirectAccuracy = float64(summary.PlayerOrder.DirectMatches) /
			float64(summary.PlayerOrder.DirectTotal)
	}
	summary.Duration = summarizeDurations(durations)
	summary.UserCPU = summarizeDurations(userCPU)
	summary.SystemCPU = summarizeDurations(systemCPU)
	summary.MaximumRSS = summarizeBytes(maximumRSS)
	return summary
}

func summarizeDurations(values []float64) durationSummary {
	if len(values) == 0 {
		return durationSummary{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	total := 0.0
	for _, value := range sorted {
		total += value
	}
	return durationSummary{
		Count: len(sorted),
		Min:   sorted[0],
		Max:   sorted[len(sorted)-1],
		Mean:  total / float64(len(sorted)),
		P50:   percentile(sorted, 0.50),
		P95:   percentile(sorted, 0.95),
		P99:   percentile(sorted, 0.99),
	}
}

func summarizeBytes(values []uint64) byteSummary {
	if len(values) == 0 {
		return byteSummary{}
	}
	sorted := append([]uint64(nil), values...)
	sort.Slice(sorted, func(left, right int) bool { return sorted[left] < sorted[right] })
	return byteSummary{
		Count: len(sorted),
		Min:   sorted[0],
		Max:   sorted[len(sorted)-1],
		P50:   bytePercentile(sorted, 0.50),
		P95:   bytePercentile(sorted, 0.95),
		P99:   bytePercentile(sorted, 0.99),
	}
}

func bytePercentile(sorted []uint64, percentile float64) uint64 {
	position := percentile * float64(len(sorted)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	interpolated := float64(sorted[lower])*(1-weight) + float64(sorted[upper])*weight
	return uint64(math.Ceil(interpolated))
}

func percentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 1 {
		return sorted[0]
	}
	position := float64(len(sorted)-1) * fraction
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	return sorted[lower] + (sorted[upper]-sorted[lower])*weight
}
