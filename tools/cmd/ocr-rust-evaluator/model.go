package main

import "encoding/json"

type expectedPlayer struct {
	PlayOrder   int
	Name        string
	Rank        *int64
	TotalAssets *int64
	Revenue     *int64
	Incidents   map[string]int64
}

type imageMetadata struct {
	Path       string
	File       string
	MatchNo    int
	ScreenType string
	Prefix     string
}

type ocrField[T any] struct {
	Value      *T                `json:"value"`
	RawText    *string           `json:"raw_text"`
	Confidence *float64          `json:"confidence"`
	Warnings   []json.RawMessage `json:"warnings"`
}

type pilotPlayer struct {
	RawPlayerName     ocrField[string]           `json:"raw_player_name"`
	MemberID          *string                    `json:"member_id"`
	PlayOrder         ocrField[int64]            `json:"play_order"`
	Rank              ocrField[int64]            `json:"rank"`
	TotalAssetsManYen ocrField[int64]            `json:"total_assets_man_yen"`
	RevenueManYen     ocrField[int64]            `json:"revenue_man_yen"`
	Incidents         map[string]ocrField[int64] `json:"incidents"`
}

type pilotEnvelope struct {
	DetectedScreenType string  `json:"detectedScreenType"`
	ProfileID          *string `json:"profileId"`
	Result             struct {
		RequestedScreenType string            `json:"requested_screen_type"`
		DetectedScreenType  *string           `json:"detected_screen_type"`
		ProfileID           *string           `json:"profile_id"`
		Players             []pilotPlayer     `json:"players"`
		CategoryPayload     json.RawMessage   `json:"category_payload"`
		Warnings            []json.RawMessage `json:"warnings"`
		RawSnippets         map[string]string `json:"raw_snippets"`
	} `json:"result"`
	Warnings            []json.RawMessage  `json:"warnings"`
	TimingsMilliseconds map[string]float64 `json:"timingsMilliseconds"`
}

type fieldOutcome struct {
	PlayOrder int    `json:"playOrder"`
	Field     string `json:"field"`
	Correct   bool   `json:"correct"`
	Expected  *int64 `json:"expected"`
	Got       *int64 `json:"got"`
}

type playerOrderDiagnostics struct {
	DirectTotal         int     `json:"directTotal"`
	DirectMatches       int     `json:"directMatches"`
	FallbackNameMatches int     `json:"fallbackNameMatches"`
	UnresolvedPlayers   int     `json:"unresolvedPlayers"`
	DirectAccuracy      float64 `json:"directAccuracy"`
}

type imageResult struct {
	File                     string                 `json:"file"`
	MatchNo                  int                    `json:"matchNo"`
	ScreenType               string                 `json:"screenType"`
	DetectedScreenType       string                 `json:"detectedScreenType,omitempty"`
	ProfileID                *string                `json:"profileId,omitempty"`
	DurationMilliseconds     float64                `json:"durationMilliseconds"`
	CoreDurationMilliseconds *float64               `json:"coreDurationMilliseconds,omitempty"`
	WarningCount             int                    `json:"warningCount"`
	Failure                  *string                `json:"failure,omitempty"`
	FieldTotal               int                    `json:"fieldTotal"`
	FieldCorrect             int                    `json:"fieldCorrect"`
	Outcomes                 []fieldOutcome         `json:"outcomes"`
	PlayerOrder              playerOrderDiagnostics `json:"playerOrder"`
}

type accuracyBucket struct {
	Images   int     `json:"images"`
	Total    int     `json:"total"`
	Correct  int     `json:"correct"`
	Accuracy float64 `json:"accuracy"`
}

type durationSummary struct {
	Count int     `json:"count"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Mean  float64 `json:"mean"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
}

type evaluationSummary struct {
	Images        int                       `json:"images"`
	FieldsTotal   int                       `json:"fieldsTotal"`
	FieldsCorrect int                       `json:"fieldsCorrect"`
	Accuracy      float64                   `json:"accuracy"`
	ByScreenType  map[string]accuracyBucket `json:"byScreenType"`
	Duration      durationSummary           `json:"durationMilliseconds"`
	PlayerOrder   playerOrderDiagnostics    `json:"playerOrder"`
	Failures      int                       `json:"failures"`
}

type pairedSummary struct {
	Fields                       int      `json:"fields"`
	BothCorrect                  int      `json:"bothCorrect"`
	BaselineOnlyCorrect          int      `json:"baselineOnlyCorrect"`
	RustOnlyCorrect              int      `json:"rustOnlyCorrect"`
	BothWrong                    int      `json:"bothWrong"`
	Discordant                   int      `json:"discordant"`
	BaselineAccuracy             float64  `json:"baselineAccuracy"`
	RustAccuracy                 float64  `json:"rustAccuracy"`
	RustMinusBaseline            float64  `json:"rustMinusBaseline"`
	MatchClusters                int      `json:"matchClusters"`
	ClusterBootstrapReplicates   int      `json:"clusterBootstrapReplicates"`
	ClusterBootstrapSeed         int64    `json:"clusterBootstrapSeed"`
	ClusterBootstrapLower95      *float64 `json:"clusterBootstrapLower95"`
	NoninferiorityMargin         float64  `json:"noninferiorityMargin"`
	PilotNoninferioritySupported bool     `json:"pilotNoninferioritySupported"`
	ReleaseDecisionAllowed       bool     `json:"releaseDecisionAllowed"`
	Method                       string   `json:"method"`
}

type evaluationReport struct {
	SchemaVersion int               `json:"schemaVersion"`
	Summary       evaluationSummary `json:"summary"`
	Paired        *pairedSummary    `json:"paired,omitempty"`
	Results       []imageResult     `json:"results"`
	Passed        bool              `json:"passed"`
}
