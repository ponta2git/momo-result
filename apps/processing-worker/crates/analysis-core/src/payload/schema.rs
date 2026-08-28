use serde_json::Value;

use super::PayloadError;

const MAX_ITEMS: usize = 1_000_000;
const MAX_TEXT_BYTES: usize = 4_096;

#[derive(Clone, Copy)]
enum Schema {
    Bool,
    ExactUnsigned(u64),
    Integer { minimum: i64, maximum: i64 },
    Unsigned { maximum: u64 },
    Number,
    NumberRange { minimum: f64, maximum: f64 },
    String { non_empty: bool },
    StringEnum(&'static [&'static str]),
    Nullable(&'static Self),
    Array { item: &'static Self, maximum: usize },
    Tuple(&'static [&'static Self]),
    Object(&'static [Field]),
    MergedObject(&'static [&'static [Field]]),
    StringMap(&'static Self),
    OneOf(&'static [&'static Self]),
}

#[derive(Clone, Copy)]
struct Field {
    name: &'static str,
    schema: &'static Schema,
}

const fn field(name: &'static str, schema: &'static Schema) -> Field {
    Field { name, schema }
}

const BOOL: Schema = Schema::Bool;
const SCHEMA_V1: Schema = Schema::ExactUnsigned(1);
const SCHEMA_V3: Schema = Schema::ExactUnsigned(3);
const COUNT: Schema = Schema::Unsigned { maximum: 1_000_000 };
const INDEX: Schema = Schema::Unsigned { maximum: 1_000_000 };
const I32: Schema = Schema::Integer {
    minimum: -2_147_483_648,
    maximum: 2_147_483_647,
};
const I64: Schema = Schema::Integer {
    minimum: i64::MIN,
    maximum: i64::MAX,
};
const RANK: Schema = Schema::Integer {
    minimum: 1,
    maximum: 4,
};
const PLAY_ORDER: Schema = RANK;
const NUMBER: Schema = Schema::Number;
const RATE: Schema = Schema::NumberRange {
    minimum: 0.0,
    maximum: 1.0,
};
const NON_NEGATIVE_NUMBER: Schema = Schema::NumberRange {
    minimum: 0.0,
    maximum: f64::MAX,
};
const ID: Schema = Schema::String { non_empty: true };
const NULLABLE_NUMBER: Schema = Schema::Nullable(&NUMBER);
const NULLABLE_RATE: Schema = Schema::Nullable(&RATE);
const NULLABLE_I32: Schema = Schema::Nullable(&I32);
const NULLABLE_RANK: Schema = Schema::Nullable(&RANK);
const NULLABLE_ID: Schema = Schema::Nullable(&ID);

const QUALITY: Schema = Schema::StringEnum(&["ok", "reference", "no_target"]);
const STABILITY: Schema = Schema::StringEnum(&["high", "medium", "low"]);
const INTENSITY: Schema = Schema::StringEnum(&["high", "medium", "low", "none"]);
const CHANGE_DIRECTION: Schema =
    Schema::StringEnum(&["first_observation", "improved", "declined", "unchanged"]);
const MEMBER_REF_FIELDS: &[Field] = &[field("memberId", &ID)];
const MEMBER_REF: Schema = Schema::Object(MEMBER_REF_FIELDS);
const MEMBER_REFS: Schema = Schema::Array {
    item: &MEMBER_REF,
    maximum: 4,
};
const IDS: Schema = Schema::Array {
    item: &ID,
    maximum: MAX_ITEMS,
};

const OVERALL_SCOPE_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["overall"])),
    field("matchCount", &COUNT),
];
const OVERALL_SCOPE: Schema = Schema::Object(OVERALL_SCOPE_FIELDS);
const SEASON_SCOPE_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["season"])),
    field("seasonMasterId", &ID),
    field("matchCount", &COUNT),
];
const SEASON_SCOPE: Schema = Schema::Object(SEASON_SCOPE_FIELDS);
const MAP_SCOPE_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["map"])),
    field("mapMasterId", &ID),
    field("matchCount", &COUNT),
];
const MAP_SCOPE: Schema = Schema::Object(MAP_SCOPE_FIELDS);
const SEASON_MAP_SCOPE_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["season_map"])),
    field("seasonMasterId", &ID),
    field("mapMasterId", &ID),
    field("matchCount", &COUNT),
];
const SEASON_MAP_SCOPE: Schema = Schema::Object(SEASON_MAP_SCOPE_FIELDS);
const SCOPE: Schema =
    Schema::OneOf(&[&OVERALL_SCOPE, &SEASON_SCOPE, &MAP_SCOPE, &SEASON_MAP_SCOPE]);

const QUALITY_SUMMARY_FIELDS: &[Field] = &[
    field("okCount", &COUNT),
    field("referenceCount", &COUNT),
    field("noTargetCount", &COUNT),
];
const QUALITY_SUMMARY: Schema = Schema::Object(QUALITY_SUMMARY_FIELDS);

const DATA_QUALITY_ITEM_FIELDS: &[Field] = &[
    field("metricId", &ID),
    field("memberId", &ID),
    field("denominator", &COUNT),
    field("targetCount", &COUNT),
    field("qualityStatus", &QUALITY),
    field("hasTies", &BOOL),
];
const DATA_QUALITY_ITEM: Schema = Schema::Object(DATA_QUALITY_ITEM_FIELDS);
const DATA_QUALITY_ITEMS: Schema = Schema::Array {
    item: &DATA_QUALITY_ITEM,
    maximum: MAX_ITEMS,
};
const DATA_QUALITY_FIELDS: &[Field] = &[
    field("items", &DATA_QUALITY_ITEMS),
    field("summary", &QUALITY_SUMMARY),
];
const DATA_QUALITY: Schema = Schema::Object(DATA_QUALITY_FIELDS);

const BASELINE_FIELDS: &[Field] = &[
    field("matchCount", &COUNT),
    field("playerCount", &COUNT),
    field("qualityStatus", &QUALITY),
];
const BASELINE: Schema = Schema::Object(BASELINE_FIELDS);
const PLAYBOOK_CATEGORY: Schema = Schema::StringEnum(&[
    "revenue",
    "destination",
    "assets",
    "playOrder",
    "ginji",
    "recovery",
    "destinationPositive",
    "accident",
]);
const SYMPTOM_UNIT: Schema = Schema::StringEnum(&["rate", "score"]);
const DRIVER_UNIT: Schema = Schema::StringEnum(&["score", "count"]);
const COMMON_TOPIC_FIELDS: &[Field] = &[
    field("topicId", &ID),
    field("category", &PLAYBOOK_CATEGORY),
    field("heading", &ID),
    field("detail", &ID),
    field("playerIds", &IDS),
];
const COMMON_TOPIC: Schema = Schema::Object(COMMON_TOPIC_FIELDS);
const COMMON_TOPICS: Schema = Schema::Array {
    item: &COMMON_TOPIC,
    maximum: 2,
};
const SYMPTOM_EVIDENCE_FIELDS: &[Field] = &[
    field("metricId", &ID),
    field("label", &ID),
    field("unit", &SYMPTOM_UNIT),
    field("value", &NUMBER),
    field("denominator", &COUNT),
    field("targetCount", &COUNT),
    field("qualityStatus", &QUALITY),
    field("stabilityBand", &STABILITY),
];
const SYMPTOM_EVIDENCE: Schema = Schema::Object(SYMPTOM_EVIDENCE_FIELDS);
const NULLABLE_METHOD: Schema =
    Schema::Nullable(&Schema::StringEnum(&["event_cluster_bootstrap_v1"]));
const DRIVER_EVIDENCE_FIELDS: &[Field] = &[
    field("metricId", &ID),
    field("label", &ID),
    field("unit", &DRIVER_UNIT),
    field("value", &NUMBER),
    field("effectEstimate", &NUMBER),
    field("method", &NULLABLE_METHOD),
    field("confidenceLow", &NULLABLE_NUMBER),
    field("confidenceHigh", &NULLABLE_NUMBER),
    field("stability", &NULLABLE_RATE),
    field("denominator", &COUNT),
    field("targetCount", &COUNT),
    field("supportCount", &COUNT),
    field("qualityStatus", &QUALITY),
    field("stabilityBand", &STABILITY),
];
const DRIVER_EVIDENCE: Schema = Schema::Object(DRIVER_EVIDENCE_FIELDS);
const CARD_EVIDENCE_ARRAY: Schema = Schema::Tuple(&[&SYMPTOM_EVIDENCE, &DRIVER_EVIDENCE]);
const CLASSIFICATION: Schema = Schema::StringEnum(&["reproduce", "revise", "verify"]);
const ANCHOR_FIELDS: &[Field] = &[
    field("view", &Schema::StringEnum(&["drivers", "context", "flow"])),
    field(
        "sectionId",
        &Schema::StringEnum(&[
            "metric-revenue-outcome",
            "metric-destination-outcome",
            "metric-money",
            "metric-play-order",
            "metric-ginji",
            "metric-momentum-switch",
            "metric-match-digest",
        ]),
    ),
    field("label", &ID),
];
const ANCHOR: Schema = Schema::Object(ANCHOR_FIELDS);
const CARD_FIELDS: &[Field] = &[
    field("cardId", &ID),
    field("classification", &CLASSIFICATION),
    field("category", &PLAYBOOK_CATEGORY),
    field("heading", &ID),
    field("actionHypothesis", &ID),
    field("triggerCondition", &ID),
    field("recommendedAction", &ID),
    field("avoidAction", &ID),
    field("dataReason", &ID),
    field("postMatchCheck", &ID),
    field("plainReason", &ID),
    field("evidenceStrength", &STABILITY),
    field("targetCount", &COUNT),
    field("evidence", &CARD_EVIDENCE_ARRAY),
    field("qualityStatus", &QUALITY),
    field("stabilityBand", &STABILITY),
    field("supportCount", &COUNT),
    field("anchorTarget", &ANCHOR),
    field("actionAdviceScore", &NUMBER),
];
const CARD: Schema = Schema::Object(CARD_FIELDS);
const NULLABLE_CARD: Schema = Schema::Nullable(&CARD);
const CARDS: Schema = Schema::Array {
    item: &CARD,
    maximum: 2,
};
const PLAYBOOK_FIELDS: &[Field] = &[
    field("player", &MEMBER_REF),
    field("primaryCard", &NULLABLE_CARD),
    field("secondaryCards", &CARDS),
];
const PLAYBOOK: Schema = Schema::Object(PLAYBOOK_FIELDS);
const PLAYBOOKS: Schema = Schema::Array {
    item: &PLAYBOOK,
    maximum: 4,
};

const REVIEW_BODY_FIELDS: &[Field] = &[
    field("baseline", &BASELINE),
    field("commonPlaybookTopics", &COMMON_TOPICS),
    field("playbookByPlayer", &PLAYBOOKS),
    field("dataQuality", &DATA_QUALITY),
];

const RANK_HISTORY_SUMMARY_FIELDS: &[Field] = &[
    field("targetCount", &COUNT),
    field("currentAverageRank", &NULLABLE_NUMBER),
    field("averageRankDeltaFromFirst", &NULLABLE_NUMBER),
    field("latestHeldEventAverageRankDelta", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
];
const RANK_HISTORY_SUMMARY: Schema = Schema::Object(RANK_HISTORY_SUMMARY_FIELDS);
const RANK_HISTORY_MATCH_ROW_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("matchIndex", &INDEX),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("heldEventId", &ID),
    field("matchNoInEvent", &I32),
    field("rank", &RANK),
    field("previousRank", &NULLABLE_RANK),
    field("rankDelta", &NULLABLE_I32),
    field("cumulativeAverageRank", &NUMBER),
    field("cumulativeAverageRankDelta", &NULLABLE_NUMBER),
    field("changeDirection", &CHANGE_DIRECTION),
];
const RANK_HISTORY_MATCH_ROW: Schema = Schema::Object(RANK_HISTORY_MATCH_ROW_FIELDS);
const RANK_HISTORY_MATCH_ROWS: Schema = Schema::Array {
    item: &RANK_HISTORY_MATCH_ROW,
    maximum: MAX_ITEMS,
};
const RANK_HISTORY_EVENT_ROW_FIELDS: &[Field] = &[
    field("heldEventId", &ID),
    field("firstPlayedAt", &NULLABLE_ID),
    field("matchCount", &COUNT),
    field(
        "ranks",
        &Schema::Array {
            item: &RANK,
            maximum: MAX_ITEMS,
        },
    ),
    field("eventAverageRank", &NUMBER),
    field("eventAverageRankDelta", &NULLABLE_NUMBER),
    field("eventRankDelta", &NULLABLE_I32),
    field("cumulativeAverageBefore", &NULLABLE_NUMBER),
    field("cumulativeAverageAfter", &NUMBER),
    field("cumulativeAverageDelta", &NULLABLE_NUMBER),
    field("changeDirection", &CHANGE_DIRECTION),
];
const RANK_HISTORY_EVENT_ROW: Schema = Schema::Object(RANK_HISTORY_EVENT_ROW_FIELDS);
const RANK_HISTORY_EVENT_ROWS: Schema = Schema::Array {
    item: &RANK_HISTORY_EVENT_ROW,
    maximum: MAX_ITEMS,
};
const RANK_HISTORY_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["rank_average_history"])),
    field("summary", &RANK_HISTORY_SUMMARY),
    field("matchRows", &RANK_HISTORY_MATCH_ROWS),
    field("eventRows", &RANK_HISTORY_EVENT_ROWS),
];
const RANK_HISTORY: Schema = Schema::Object(RANK_HISTORY_FIELDS);

const PLAY_ORDER_COUNT_FIELDS: &[Field] =
    &[field("playOrder", &PLAY_ORDER), field("matchCount", &COUNT)];
const PLAY_ORDER_COUNT: Schema = Schema::Object(PLAY_ORDER_COUNT_FIELDS);
const PLAY_ORDER_COUNTS: Schema = Schema::Array {
    item: &PLAY_ORDER_COUNT,
    maximum: 4,
};
const PLAY_ORDER_SUMMARY_FIELDS: &[Field] = &[
    field("targetCount", &COUNT),
    field("currentAverageRank", &NULLABLE_NUMBER),
    field("bestPlayOrder", &NULLABLE_RANK),
    field("bestPlayOrderAverageRank", &NULLABLE_NUMBER),
    field("worstPlayOrder", &NULLABLE_RANK),
    field("worstPlayOrderAverageRank", &NULLABLE_NUMBER),
    field("spread", &NULLABLE_NUMBER),
    field("countsByPlayOrder", &PLAY_ORDER_COUNTS),
    field("qualityStatus", &QUALITY),
];
const PLAY_ORDER_SUMMARY: Schema = Schema::Object(PLAY_ORDER_SUMMARY_FIELDS);
const PLAY_ORDER_SERIES_ROW_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("matchIndex", &INDEX),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("heldEventId", &ID),
    field("matchNoInEvent", &I32),
    field("playOrder", &PLAY_ORDER),
    field("rank", &RANK),
    field("occurrenceIndex", &INDEX),
    field("cumulativeAverageRank", &NUMBER),
    field("previousCumulativeAverageRank", &NULLABLE_NUMBER),
    field("changeDirection", &CHANGE_DIRECTION),
];
const PLAY_ORDER_SERIES_ROW: Schema = Schema::Object(PLAY_ORDER_SERIES_ROW_FIELDS);
const PLAY_ORDER_SERIES_ROWS: Schema = Schema::Array {
    item: &PLAY_ORDER_SERIES_ROW,
    maximum: MAX_ITEMS,
};
const RANK_CELL_FIELDS: &[Field] = &[
    field("rank", &RANK),
    field("count", &COUNT),
    field("rate", &NULLABLE_RATE),
];
const RANK_CELL: Schema = Schema::Object(RANK_CELL_FIELDS);
const RANK_CELLS: Schema = Schema::Array {
    item: &RANK_CELL,
    maximum: 4,
};
const PLAY_ORDER_ROW_FIELDS: &[Field] = &[
    field("playOrder", &PLAY_ORDER),
    field("targetCount", &COUNT),
    field("rankAverage", &NULLABLE_NUMBER),
    field("rankDistribution", &RANK_CELLS),
    field("podiumCount", &COUNT),
    field("podiumRate", &NULLABLE_RATE),
    field("lowerHalfCount", &COUNT),
    field("lowerHalfRate", &NULLABLE_RATE),
    field("baselineRankAverage", &NULLABLE_NUMBER),
    field("baselineDelta", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
];
const PLAY_ORDER_ROW: Schema = Schema::Object(PLAY_ORDER_ROW_FIELDS);
const PLAY_ORDER_ROWS: Schema = Schema::Array {
    item: &PLAY_ORDER_ROW,
    maximum: 4,
};
const PLAY_ORDER_HISTORY_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["play_order_rank_history"])),
    field("summary", &PLAY_ORDER_SUMMARY),
    field("seriesByPlayOrder", &PLAY_ORDER_SERIES_ROWS),
    field("rows", &PLAY_ORDER_ROWS),
];
const PLAY_ORDER_HISTORY: Schema = Schema::Object(PLAY_ORDER_HISTORY_FIELDS);

const REASON_CODE: Schema = Schema::StringEnum(&[
    "insufficient_matches",
    "insufficient_events",
    "model_not_better",
    "unstable_signals",
    "model_not_converged",
    "calculation_failed",
    "invalid_dataset",
]);
const REASON_CODES: Schema = Schema::Array {
    item: &REASON_CODE,
    maximum: 4,
};
const SIGNAL_KIND: Schema = Schema::StringEnum(&[
    "revenue",
    "destination",
    "plus_station",
    "minus_station",
    "card_station",
    "card_shop",
    "ginji",
]);
const SIGNAL_DIRECTION: Schema = Schema::StringEnum(&["more_is_higher", "less_is_higher"]);
const NULLABLE_PERCENT: Schema = Schema::Nullable(&Schema::Unsigned { maximum: 100 });
const SIGNAL_CANDIDATE_FIELDS: &[Field] = &[
    field("signal", &SIGNAL_KIND),
    field("direction", &SIGNAL_DIRECTION),
    field("importance", &NON_NEGATIVE_NUMBER),
    field("stable", &BOOL),
    field("supportCount", &COUNT),
    field("stabilityBand", &STABILITY),
    field("candidateSharePercent", &NULLABLE_PERCENT),
];
const SIGNAL_CANDIDATE: Schema = Schema::Object(SIGNAL_CANDIDATE_FIELDS);
const FOLD_ROW_FIELDS: &[Field] = &[
    field("fold", &COUNT),
    field("heldEventCount", &COUNT),
    field("comparisonCount", &COUNT),
    field("importance", &NON_NEGATIVE_NUMBER),
    field("supported", &BOOL),
];
const FOLD_ROW: Schema = Schema::Object(FOLD_ROW_FIELDS);
const FOLD_ROWS: Schema = Schema::Array {
    item: &FOLD_ROW,
    maximum: 5,
};
const SIGNAL_DRILLDOWN_CANDIDATE_FIELDS: &[Field] = &[
    field("signal", &SIGNAL_KIND),
    field("direction", &SIGNAL_DIRECTION),
    field("importance", &NON_NEGATIVE_NUMBER),
    field("stable", &BOOL),
    field("supportCount", &COUNT),
    field("stabilityBand", &STABILITY),
    field("candidateSharePercent", &NULLABLE_PERCENT),
    field("foldRows", &FOLD_ROWS),
];
const SIGNAL_DRILLDOWN_CANDIDATE: Schema = Schema::Object(SIGNAL_DRILLDOWN_CANDIDATE_FIELDS);
const SIGNAL_DRILLDOWN_CANDIDATES: Schema = Schema::Array {
    item: &SIGNAL_DRILLDOWN_CANDIDATE,
    maximum: 7,
};
const SIGNAL_METHOD_FIELDS: &[Field] = &[
    field("modelVersion", &Schema::StringEnum(&["rank-bt-v1"])),
    field("fixedSeed", &ID),
    field("minimumHeldEvents", &COUNT),
    field("minimumMatches", &COUNT),
    field("foldCount", &COUNT),
    field("requiredImprovedFoldCount", &COUNT),
    field("minimumImportance", &NON_NEGATIVE_NUMBER),
];
const SIGNAL_METHOD: Schema = Schema::Object(SIGNAL_METHOD_FIELDS);
const SIGNAL_DRILLDOWN_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["rank_signals"])),
    field("method", &SIGNAL_METHOD),
    field("status", &QUALITY),
    field("reasonCodes", &REASON_CODES),
    field("heldEventCount", &COUNT),
    field("matchCount", &COUNT),
    field("improvedFoldCount", &COUNT),
    field("candidates", &SIGNAL_DRILLDOWN_CANDIDATES),
];
const SIGNAL_DRILLDOWN: Schema = Schema::Object(SIGNAL_DRILLDOWN_FIELDS);

const UNEXPECTED_EVIDENCE_FIELDS: &[Field] = &[
    field("revenueManYen", &I32),
    field("destinationCount", &I32),
    field("plusStationCount", &I32),
    field("minusStationCount", &I32),
    field("cardStationCount", &I32),
    field("cardShopCount", &I32),
    field("ginjiCount", &I32),
];
const UNEXPECTED_EVIDENCE: Schema = Schema::Object(UNEXPECTED_EVIDENCE_FIELDS);
const UNEXPECTED_ROW_FIELDS: &[Field] = &[
    field("matchIndex", &INDEX),
    field("matchId", &ID),
    field("heldEventId", &ID),
    field("matchNoInEvent", &I32),
    field("playedAt", &ID),
    field("expectedRank", &NUMBER),
    field("actualRank", &RANK),
    field("evidence", &UNEXPECTED_EVIDENCE),
];
const UNEXPECTED_ROW: Schema = Schema::Object(UNEXPECTED_ROW_FIELDS);
const UNEXPECTED_ROWS: Schema = Schema::Array {
    item: &UNEXPECTED_ROW,
    maximum: MAX_ITEMS,
};
const UNEXPECTED_SUMMARY_FIELDS: &[Field] = &[
    field("status", &QUALITY),
    field("reasonCodes", &REASON_CODES),
    field("heldEventCount", &COUNT),
    field("matchCount", &COUNT),
    field("totalWinCount", &COUNT),
    field("unexpectedWinCount", &COUNT),
];
const UNEXPECTED_SUMMARY: Schema = Schema::Object(UNEXPECTED_SUMMARY_FIELDS);
const UNEXPECTED_DRILLDOWN_FIELDS: &[Field] = &[
    field("kind", &Schema::StringEnum(&["unexpected_wins"])),
    field("summary", &UNEXPECTED_SUMMARY),
    field("rows", &UNEXPECTED_ROWS),
];
const UNEXPECTED_DRILLDOWN: Schema = Schema::Object(UNEXPECTED_DRILLDOWN_FIELDS);

const CONTEXT_PLAYER_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("rank", &RANK),
    field("totalAssetsManYen", &I32),
    field("revenueManYen", &I32),
    field("revenueRank", &NULLABLE_NUMBER),
    field("revenueAssetRate", &NULLABLE_NUMBER),
    field("previousRank", &NULLABLE_RANK),
    field("cumulativeAverageBefore", &NULLABLE_NUMBER),
    field("cumulativeAverageAfter", &NUMBER),
    field("cumulativeAverageDelta", &NULLABLE_NUMBER),
    field("cumulativeAverageDirection", &CHANGE_DIRECTION),
];
const CONTEXT_PLAYER: Schema = Schema::Object(CONTEXT_PLAYER_FIELDS);
const CONTEXT_PLAYERS: Schema = Schema::Array {
    item: &CONTEXT_PLAYER,
    maximum: 4,
};
const METRIC_EVIDENCE_FIELDS: &[Field] = &[
    field("metricId", &ID),
    field("unit", &Schema::StringEnum(&["count"])),
    field("value", &NULLABLE_NUMBER),
    field("denominator", &Schema::Nullable(&COUNT)),
    field("qualityStatus", &QUALITY),
];
const METRIC_EVIDENCE: Schema = Schema::Object(METRIC_EVIDENCE_FIELDS);
const METRIC_EVIDENCE_ARRAY: Schema = Schema::Array {
    item: &METRIC_EVIDENCE,
    maximum: 8,
};
const FEATURE_CODE: Schema = Schema::StringEnum(&[
    "close_finish",
    "asset_blowout",
    "revenue_top_no_win",
    "ginji_storm",
    "negative_assets",
    "no_destination",
]);
const FEATURE_SOURCE: Schema = Schema::StringEnum(&["match"]);
const FEATURE_TONE: Schema = Schema::StringEnum(&["neutral", "notice"]);
const CONTEXT_FEATURE_FIELDS: &[Field] = &[
    field("featureCode", &FEATURE_CODE),
    field("source", &FEATURE_SOURCE),
    field("priority", &I32),
    field("tone", &FEATURE_TONE),
    field("memberIds", &IDS),
    field("evidence", &METRIC_EVIDENCE_ARRAY),
];
const CONTEXT_FEATURE: Schema = Schema::Object(CONTEXT_FEATURE_FIELDS);
const CONTEXT_FEATURES: Schema = Schema::Array {
    item: &CONTEXT_FEATURE,
    maximum: 6,
};
const CONTEXT_MATCH_FIELDS: &[Field] = &[
    field("matchIndex", &INDEX),
    field("playedAt", &NULLABLE_ID),
    field("players", &CONTEXT_PLAYERS),
    field("focusedItemIds", &IDS),
    field("features", &CONTEXT_FEATURES),
];
const CONTEXT_MATCH: Schema = Schema::Object(CONTEXT_MATCH_FIELDS);

const AGGREGATE_SUMMARY_FIELDS: &[Field] = &[
    field("leaderMemberIds", &IDS),
    field("averageRankSpread", &NULLABLE_NUMBER),
    field(
        "rankSpreadSignal",
        &Schema::StringEnum(&["insufficient", "flat", "small", "visible", "large"]),
    ),
    field("totalGinjiCount", &COUNT),
    field("quality", &QUALITY_SUMMARY),
];
const AGGREGATE_SUMMARY: Schema = Schema::Object(AGGREGATE_SUMMARY_FIELDS);
const PLAYER_RANK_FIELDS: &[Field] = &[
    field("average", &NULLABLE_NUMBER),
    field("standardDeviation", &NULLABLE_NUMBER),
    field("distribution", &RANK_CELLS),
];
const PLAYER_RANK: Schema = Schema::Object(PLAYER_RANK_FIELDS);
const PLAYER_ASSETS_FIELDS: &[Field] = &[
    field("max", &NULLABLE_I32),
    field("min", &NULLABLE_I32),
    field("average", &NULLABLE_NUMBER),
    field("median", &NULLABLE_NUMBER),
];
const PLAYER_ASSETS: Schema = Schema::Object(PLAYER_ASSETS_FIELDS);
const PLAYER_REVENUE_FIELDS: &[Field] = &[
    field("max", &NULLABLE_I32),
    field("average", &NULLABLE_NUMBER),
    field("median", &NULLABLE_NUMBER),
];
const PLAYER_REVENUE: Schema = Schema::Object(PLAYER_REVENUE_FIELDS);
const COUNT_RATE_FIELDS: &[Field] = &[field("count", &COUNT), field("rate", &NULLABLE_RATE)];
const COUNT_RATE: Schema = Schema::Object(COUNT_RATE_FIELDS);
const PLAY_ORDER_METRIC_ROW_FIELDS: &[Field] = &[
    field("playOrder", &PLAY_ORDER),
    field("matchCount", &COUNT),
    field("rankAverage", &NULLABLE_NUMBER),
    field("assetsAverage", &NULLABLE_NUMBER),
    field("revenueAverage", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
];
const PLAY_ORDER_METRIC_ROW: Schema = Schema::Object(PLAY_ORDER_METRIC_ROW_FIELDS);
const PLAY_ORDER_METRIC_ROWS: Schema = Schema::Array {
    item: &PLAY_ORDER_METRIC_ROW,
    maximum: 4,
};
const PLAY_ORDER_METRICS_FIELDS: &[Field] = &[
    field("assetsDiff", &NULLABLE_NUMBER),
    field("revenueDiff", &NULLABLE_NUMBER),
    field("assetsIndex", &NULLABLE_NUMBER),
    field("revenueIndex", &NULLABLE_NUMBER),
    field("breakdown", &PLAY_ORDER_METRIC_ROWS),
];
const PLAY_ORDER_METRICS: Schema = Schema::Object(PLAY_ORDER_METRICS_FIELDS);
const GINJI_FIELDS: &[Field] = &[
    field("count", &COUNT),
    field("encounterMatches", &COUNT),
    field("encounterRate", &NULLABLE_RATE),
    field("multiEncounterMatchCount", &COUNT),
    field("maxInSingleMatch", &I32),
    field("resilienceRankAverage", &NULLABLE_NUMBER),
    field("resilienceAssetsAverage", &NULLABLE_NUMBER),
    field("resilienceRevenueAverage", &NULLABLE_NUMBER),
];
const GINJI: Schema = Schema::Object(GINJI_FIELDS);
const NON_REVENUE_FIELDS: &[Field] = &[
    field("rankDelta", &NULLABLE_NUMBER),
    field("highRevenueNoWinCount", &COUNT),
    field("highRevenueTopCount", &COUNT),
    field("highRevenueNoWinRate", &NULLABLE_RATE),
];
const NON_REVENUE: Schema = Schema::Object(NON_REVENUE_FIELDS);
const DESTINATION_FIELDS: &[Field] = &[
    field("conversionDelta", &NULLABLE_NUMBER),
    field("dependenceScore", &NULLABLE_NUMBER),
    field("upperTargetCount", &COUNT),
    field("lowerTargetCount", &COUNT),
];
const DESTINATION: Schema = Schema::Object(DESTINATION_FIELDS);
const CONDITIONAL_OUTCOME_FIELDS: &[Field] = &[
    field("targetCount", &COUNT),
    field("winCount", &COUNT),
    field("winRate", &NULLABLE_RATE),
    field("podiumCount", &COUNT),
    field("podiumRate", &NULLABLE_RATE),
    field("lowerHalfCount", &COUNT),
    field("lowerHalfRate", &NULLABLE_RATE),
    field("rankDistribution", &RANK_CELLS),
    field("qualityStatus", &QUALITY),
];
const CONDITIONAL_OUTCOME: Schema = Schema::Object(CONDITIONAL_OUTCOME_FIELDS);
const REVENUE_OUTCOME_FIELDS: &[Field] = &[
    field("top", &CONDITIONAL_OUTCOME),
    field("lowRevenue", &CONDITIONAL_OUTCOME),
    field("nonTopWinCount", &COUNT),
];
const REVENUE_OUTCOME: Schema = Schema::Object(REVENUE_OUTCOME_FIELDS);
const DESTINATION_OUTCOME_FIELDS: &[Field] = &[
    field("top", &CONDITIONAL_OUTCOME),
    field("lowDestination", &CONDITIONAL_OUTCOME),
    field("zeroDestination", &CONDITIONAL_OUTCOME),
];
const DESTINATION_OUTCOME: Schema = Schema::Object(DESTINATION_OUTCOME_FIELDS);
const PLAYER_METRICS_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("denominator", &COUNT),
    field("qualityStatus", &QUALITY),
    field("rank", &PLAYER_RANK),
    field("assets", &PLAYER_ASSETS),
    field("revenue", &PLAYER_REVENUE),
    field("podium", &COUNT_RATE),
    field("lowerHalf", &COUNT_RATE),
    field("playOrder", &PLAY_ORDER_METRICS),
    field("ginji", &GINJI),
    field("nonRevenue", &NON_REVENUE),
    field("destination", &DESTINATION),
    field("revenueOutcome", &REVENUE_OUTCOME),
    field("destinationOutcome", &DESTINATION_OUTCOME),
];
const PLAYER_METRICS: Schema = Schema::Object(PLAYER_METRICS_FIELDS);
const PLAYER_METRICS_ARRAY: Schema = Schema::Array {
    item: &PLAYER_METRICS,
    maximum: 4,
};

const DISTRIBUTION_CELL_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("rank", &RANK),
    field("count", &COUNT),
    field("rate", &NULLABLE_RATE),
];
const DISTRIBUTION_CELL: Schema = Schema::Object(DISTRIBUTION_CELL_FIELDS);
const DISTRIBUTION_CELLS: Schema = Schema::Array {
    item: &DISTRIBUTION_CELL,
    maximum: 4,
};
const RANK_DISTRIBUTION_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("total", &COUNT),
    field("qualityStatus", &QUALITY),
    field("cells", &DISTRIBUTION_CELLS),
];
const RANK_DISTRIBUTION: Schema = Schema::Object(RANK_DISTRIBUTION_FIELDS);
const RANK_DISTRIBUTIONS: Schema = Schema::Array {
    item: &RANK_DISTRIBUTION,
    maximum: 4,
};
const RECENT_RANK_ROW_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("rank", &RANK),
];
const RECENT_RANK_ROW: Schema = Schema::Object(RECENT_RANK_ROW_FIELDS);
const RECENT_RANK_ROWS: Schema = Schema::Array {
    item: &RECENT_RANK_ROW,
    maximum: 20,
};
const RECENT_RANK_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("windowSize", &COUNT),
    field("targetCount", &COUNT),
    field("usedFallback", &BOOL),
    field("qualityStatus", &QUALITY),
    field("averageRank", &NULLABLE_NUMBER),
    field("podiumRate", &NULLABLE_RATE),
    field("winStreak", &COUNT),
    field("podiumStreak", &COUNT),
    field("lowerHalfStreak", &COUNT),
    field("rows", &RECENT_RANK_ROWS),
];
const RECENT_RANK: Schema = Schema::Object(RECENT_RANK_FIELDS);
const RECENT_RANKS: Schema = Schema::Array {
    item: &RECENT_RANK,
    maximum: 4,
};
const STRATEGY_POINT_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("matchIndex", &INDEX),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("memberId", &ID),
    field("rank", &RANK),
    field("totalAssetsManYen", &I32),
    field("revenueManYen", &I32),
    field("revenueAssetRate", &NULLABLE_NUMBER),
    field("assetRank", &NULLABLE_NUMBER),
    field("revenueRank", &NULLABLE_NUMBER),
];
const STRATEGY_POINT: Schema = Schema::Object(STRATEGY_POINT_FIELDS);
const STRATEGY_POINTS: Schema = Schema::Array {
    item: &STRATEGY_POINT,
    maximum: MAX_ITEMS,
};
const STRATEGY_SCATTER_FIELDS: &[Field] = &[field("points", &STRATEGY_POINTS)];
const STRATEGY_SCATTER: Schema = Schema::Object(STRATEGY_SCATTER_FIELDS);

const PLAY_ORDER_SIGNAL: Schema = Schema::StringEnum(&["no_target", "flat", "visible", "large"]);
const PLAY_ORDER_COMPARISON_CELL_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("playOrder", &PLAY_ORDER),
    field("targetCount", &COUNT),
    field("rankAverage", &NULLABLE_NUMBER),
    field("podiumRate", &NULLABLE_RATE),
    field("qualityStatus", &QUALITY),
    field("relativeIntensity", &INTENSITY),
];
const PLAY_ORDER_COMPARISON_CELL: Schema = Schema::Object(PLAY_ORDER_COMPARISON_CELL_FIELDS);
const PLAY_ORDER_COMPARISON_CELLS: Schema = Schema::Array {
    item: &PLAY_ORDER_COMPARISON_CELL,
    maximum: 4,
};
const PLAY_ORDER_COMPARISON_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("bestPlayOrder", &NULLABLE_RANK),
    field("worstPlayOrder", &NULLABLE_RANK),
    field("spread", &NULLABLE_NUMBER),
    field("signal", &PLAY_ORDER_SIGNAL),
    field("cells", &PLAY_ORDER_COMPARISON_CELLS),
];
const PLAY_ORDER_COMPARISON: Schema = Schema::Object(PLAY_ORDER_COMPARISON_FIELDS);
const PLAY_ORDER_COMPARISONS: Schema = Schema::Array {
    item: &PLAY_ORDER_COMPARISON,
    maximum: 4,
};
const REVENUE_CONVERSION_CELL_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("revenueRank", &RANK),
    field("finalRank", &RANK),
    field("count", &COUNT),
    field("rate", &NULLABLE_RATE),
    field("hasRevenueTie", &BOOL),
    field("relativeIntensity", &INTENSITY),
];
const REVENUE_CONVERSION_CELL: Schema = Schema::Object(REVENUE_CONVERSION_CELL_FIELDS);
const REVENUE_CONVERSION_CELLS: Schema = Schema::Array {
    item: &REVENUE_CONVERSION_CELL,
    maximum: 16,
};
const REVENUE_CONVERSION_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("cells", &REVENUE_CONVERSION_CELLS),
];
const REVENUE_CONVERSION: Schema = Schema::Object(REVENUE_CONVERSION_FIELDS);
const REVENUE_CONVERSIONS: Schema = Schema::Array {
    item: &REVENUE_CONVERSION,
    maximum: 4,
};

const TREND_KIND: Schema = Schema::StringEnum(&[
    "rank_cumulative_average",
    "rank_cumulative_standard_deviation",
    "podium_cumulative_rate",
    "lower_half_cumulative_rate",
    "ginji_cumulative_count",
]);
const TREND_POINT_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("index", &INDEX),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("value", &NUMBER),
];
const TREND_POINT: Schema = Schema::Object(TREND_POINT_FIELDS);
const TREND_POINTS: Schema = Schema::Array {
    item: &TREND_POINT,
    maximum: MAX_ITEMS,
};
const TREND_FIELDS: &[Field] = &[
    field("kind", &TREND_KIND),
    field("memberId", &ID),
    field("points", &TREND_POINTS),
];
const TREND: Schema = Schema::Object(TREND_FIELDS);
const TRENDS: Schema = Schema::Array {
    item: &TREND,
    maximum: 20,
};
const HISTOGRAM_BIN_FIELDS: &[Field] = &[
    field("index", &INDEX),
    field("lowerInclusive", &I32),
    field("upperExclusive", &NULLABLE_I32),
    field("label", &ID),
];
const HISTOGRAM_BIN: Schema = Schema::Object(HISTOGRAM_BIN_FIELDS);
const HISTOGRAM_BINS: Schema = Schema::Array {
    item: &HISTOGRAM_BIN,
    maximum: 7,
};
const COUNTS: Schema = Schema::Array {
    item: &COUNT,
    maximum: 7,
};
const HISTOGRAM_SERIES_FIELDS: &[Field] = &[field("memberId", &ID), field("counts", &COUNTS)];
const HISTOGRAM_SERIES_ENTRY: Schema = Schema::Object(HISTOGRAM_SERIES_FIELDS);
const HISTOGRAM_SERIES: Schema = Schema::Array {
    item: &HISTOGRAM_SERIES_ENTRY,
    maximum: 4,
};
const HISTOGRAM_FIELDS: &[Field] = &[
    field("bins", &HISTOGRAM_BINS),
    field("series", &HISTOGRAM_SERIES),
];
const HISTOGRAM: Schema = Schema::Object(HISTOGRAM_FIELDS);
const HISTOGRAMS_FIELDS: &[Field] = &[field("assets", &HISTOGRAM), field("revenue", &HISTOGRAM)];
const HISTOGRAMS: Schema = Schema::Object(HISTOGRAMS_FIELDS);

const HEAD_SIGNAL: Schema = Schema::StringEnum(&[
    "no_target",
    "reference",
    "neutral",
    "slight_advantage",
    "strong_advantage",
    "slight_disadvantage",
    "strong_disadvantage",
]);
const SELF_SIGNAL: Schema = Schema::StringEnum(&["self"]);
const SELF_HEAD_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("subjectMemberId", &ID),
    field("opponentMemberId", &ID),
    field("matchCount", &COUNT),
    field("betterRankCount", &COUNT),
    field("betterRankRate", &NULLABLE_RATE),
    field("averageRankDiff", &NULLABLE_NUMBER),
    field("averageAssetsDiff", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
    field("signal", &SELF_SIGNAL),
    field("relativeIntensity", &INTENSITY),
];
const SELF_HEAD: Schema = Schema::Object(SELF_HEAD_FIELDS);
const HEAD_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("subjectMemberId", &ID),
    field("opponentMemberId", &ID),
    field("matchCount", &COUNT),
    field("sampleMaturity", &Schema::StringEnum(&["early", "mature"])),
    field("betterRankCount", &COUNT),
    field("betterRankRate", &NULLABLE_RATE),
    field("averageRankDiff", &NULLABLE_NUMBER),
    field("averageAssetsDiff", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
    field("signal", &HEAD_SIGNAL),
    field("relativeIntensity", &INTENSITY),
];
const HEAD: Schema = Schema::Object(HEAD_FIELDS);
const HEAD_ENTRY: Schema = Schema::OneOf(&[&SELF_HEAD, &HEAD]);
const HEAD_ENTRIES: Schema = Schema::Array {
    item: &HEAD_ENTRY,
    maximum: 16,
};
const HEAD_TO_HEAD_FIELDS: &[Field] = &[field("entries", &HEAD_ENTRIES)];
const HEAD_TO_HEAD: Schema = Schema::Object(HEAD_TO_HEAD_FIELDS);

const MOMENTUM_SIGNAL: Schema = Schema::StringEnum(&["strength", "risk", "none"]);
const MOMENTUM_RATE_FIELDS: &[Field] = &[
    field("targetCount", &COUNT),
    field("successCount", &COUNT),
    field("rate", &NULLABLE_RATE),
    field("baselineRate", &NULLABLE_RATE),
    field("deltaFromBaseline", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
    field("signal", &MOMENTUM_SIGNAL),
];
const MOMENTUM_RATE: Schema = Schema::Object(MOMENTUM_RATE_FIELDS);
const MOMENTUM_CELL_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("previousRank", &RANK),
    field("nextRank", &RANK),
    field("targetCount", &COUNT),
    field("count", &COUNT),
    field("rate", &NULLABLE_RATE),
    field("qualityStatus", &QUALITY),
    field("relativeIntensity", &INTENSITY),
];
const MOMENTUM_CELL: Schema = Schema::Object(MOMENTUM_CELL_FIELDS);
const MOMENTUM_CELLS: Schema = Schema::Array {
    item: &MOMENTUM_CELL,
    maximum: 16,
};
const MOMENTUM_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("denominator", &COUNT),
    field("transitionCount", &COUNT),
    field("afterLower", &MOMENTUM_RATE),
    field("afterFourth", &MOMENTUM_RATE),
    field("afterPodium", &MOMENTUM_RATE),
    field("cells", &MOMENTUM_CELLS),
];
const MOMENTUM: Schema = Schema::Object(MOMENTUM_FIELDS);
const MOMENTUM_ARRAY: Schema = Schema::Array {
    item: &MOMENTUM,
    maximum: 4,
};

const NULLABLE_PROFILE: Schema = Schema::Nullable(&Schema::StringEnum(&[
    "steady_leader",
    "swing_leader",
    "steady_chaser",
    "swing_chaser",
]));
const NULLABLE_STRATEGY: Schema = Schema::Nullable(&Schema::StringEnum(&[
    "property_focused",
    "card_focused",
    "balanced",
]));
const PERFORMANCE_ENTRY_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("rankStandardDeviation", &NULLABLE_NUMBER),
    field("averageRankScore", &NULLABLE_NUMBER),
    field("averageRevenueAssetRate", &NULLABLE_NUMBER),
    field("profileKind", &NULLABLE_PROFILE),
    field("strategyKind", &NULLABLE_STRATEGY),
    field("qualityStatus", &QUALITY),
];
const PERFORMANCE_ENTRY: Schema = Schema::Object(PERFORMANCE_ENTRY_FIELDS);
const PERFORMANCE_ENTRIES: Schema = Schema::Array {
    item: &PERFORMANCE_ENTRY,
    maximum: 4,
};
const PERFORMANCE_FIELDS: &[Field] = &[
    field("rankStandardDeviationMedian", &NULLABLE_NUMBER),
    field("averageRankScoreMedian", &NULLABLE_NUMBER),
    field("averageRevenueAssetRateMedian", &NULLABLE_NUMBER),
    field("entries", &PERFORMANCE_ENTRIES),
];
const PERFORMANCE: Schema = Schema::Object(PERFORMANCE_FIELDS);

const ASSET_PRIMARY: Schema = Schema::StringEnum(&[
    "asset_explosion",
    "high_risk_breakthrough",
    "close_collector",
    "steady_accumulator",
    "upper_chaser",
    "balanced",
]);
const NULLABLE_ASSET_PRIMARY: Schema = Schema::Nullable(&ASSET_PRIMARY);
const ASSET_SHAPE: Schema = Schema::StringEnum(&[
    "two_tailed",
    "upper_side",
    "lower_tail",
    "thin_right_tail",
    "right_tail",
    "middle_heavy",
]);
const NULLABLE_ASSET_SHAPE: Schema = Schema::Nullable(&ASSET_SHAPE);
const ASSET_TAG: Schema = Schema::StringEnum(&[
    "high_variance",
    "mobility_collecting",
    "upper_chaser",
    "property_base",
    "downside_risk",
    "card_base",
    "close_finish",
]);
const ASSET_TAGS: Schema = Schema::Array {
    item: &ASSET_TAG,
    maximum: 7,
};
const ASSET_EVIDENCE_KIND: Schema =
    Schema::StringEnum(&["high_asset_rate", "low_asset_rate", "win_rate"]);
const ASSET_EVIDENCE_TONE: Schema = Schema::StringEnum(&["strength", "risk", "neutral"]);
const ASSET_EVIDENCE_FIELDS: &[Field] = &[
    field("kind", &ASSET_EVIDENCE_KIND),
    field("value", &NULLABLE_RATE),
    field("tone", &ASSET_EVIDENCE_TONE),
];
const ASSET_EVIDENCE: Schema = Schema::Object(ASSET_EVIDENCE_FIELDS);
const ASSET_EVIDENCE_ARRAY: Schema = Schema::Array {
    item: &ASSET_EVIDENCE,
    maximum: 3,
};
const ASSET_METRICS_FIELDS: &[Field] = &[
    field("p10Assets", &NULLABLE_NUMBER),
    field("medianAssets", &NULLABLE_NUMBER),
    field("p90Assets", &NULLABLE_NUMBER),
    field("p90P10Spread", &NULLABLE_NUMBER),
    field("highAssetCount", &COUNT),
    field("highAssetRate", &NULLABLE_RATE),
    field("lowAssetCount", &COUNT),
    field("lowAssetRate", &NULLABLE_RATE),
    field("winCount", &COUNT),
    field("winRate", &NULLABLE_RATE),
    field("podiumRate", &NULLABLE_RATE),
    field("secondCount", &COUNT),
    field("secondRate", &NULLABLE_RATE),
    field("lowerHalfRate", &NULLABLE_RATE),
    field("winMedianAssets", &NULLABLE_NUMBER),
    field("winMedianMargin", &NULLABLE_NUMBER),
    field("secondMedianGap", &NULLABLE_NUMBER),
    field("lowerHalfMedianGap", &NULLABLE_NUMBER),
    field("blowoutWinCount", &COUNT),
    field("nearMissSecondCount", &COUNT),
    field("heavyLossCount", &COUNT),
    field("averageRevenueAssetRate", &NULLABLE_NUMBER),
    field("destinationAverage", &NULLABLE_NUMBER),
    field("destinationPositiveRate", &NULLABLE_RATE),
];
const ASSET_METRICS: Schema = Schema::Object(ASSET_METRICS_FIELDS);
const ASSET_ENTRY_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("targetCount", &COUNT),
    field("primaryKind", &NULLABLE_ASSET_PRIMARY),
    field("secondaryKind", &Schema::Nullable(&ASSET_TAG)),
    field("shapeKind", &NULLABLE_ASSET_SHAPE),
    field("tags", &ASSET_TAGS),
    field("qualityStatus", &QUALITY),
    field("evidence", &ASSET_EVIDENCE_ARRAY),
    field("metrics", &ASSET_METRICS),
];
const ASSET_ENTRY: Schema = Schema::Object(ASSET_ENTRY_FIELDS);
const ASSET_ENTRIES: Schema = Schema::Array {
    item: &ASSET_ENTRY,
    maximum: 4,
};
const ASSET_STYLE_FIELDS: &[Field] = &[
    field("lowAssetThreshold", &NULLABLE_I32),
    field("highAssetThreshold", &NULLABLE_I32),
    field("blowoutWinThreshold", &NULLABLE_I32),
    field("nearMissSecondThreshold", &NULLABLE_I32),
    field("heavyLossThreshold", &NULLABLE_I32),
    field("entries", &ASSET_ENTRIES),
];
const ASSET_STYLE: Schema = Schema::Object(ASSET_STYLE_FIELDS);

const CARD_SHOP_KIND: Schema = Schema::StringEnum(&[
    "destination_with_shop",
    "destination_without_shop",
    "no_destination_with_shop",
    "no_destination_without_shop",
]);
const CARD_SHOP_QUADRANT_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("kind", &CARD_SHOP_KIND),
    field("targetCount", &COUNT),
    field("rate", &NULLABLE_RATE),
    field("averageRank", &NULLABLE_NUMBER),
    field("winRate", &NULLABLE_RATE),
    field("podiumRate", &NULLABLE_RATE),
    field("averageAssets", &NULLABLE_NUMBER),
    field("averageRevenue", &NULLABLE_NUMBER),
    field("qualityStatus", &QUALITY),
];
const CARD_SHOP_QUADRANT: Schema = Schema::Object(CARD_SHOP_QUADRANT_FIELDS);
const CARD_SHOP_QUADRANTS: Schema = Schema::Array {
    item: &CARD_SHOP_QUADRANT,
    maximum: 4,
};
const CARD_SHOP_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("denominator", &COUNT),
    field("cardShopMatchCount", &COUNT),
    field("cardShopRate", &NULLABLE_RATE),
    field("cardShopWithoutDestinationCount", &COUNT),
    field("cardShopWithoutDestinationRate", &NULLABLE_RATE),
    field("quadrants", &CARD_SHOP_QUADRANTS),
];
const CARD_SHOP: Schema = Schema::Object(CARD_SHOP_FIELDS);
const CARD_SHOPS: Schema = Schema::Array {
    item: &CARD_SHOP,
    maximum: 4,
};

const MATCH_FLAG: Schema = Schema::StringEnum(&[
    "revenue_top_no_win",
    "ginji_storm",
    "close_finish",
    "asset_blowout",
]);
const MATCH_FLAGS: Schema = Schema::Array {
    item: &MATCH_FLAG,
    maximum: 4,
};
const MATCH_DIGEST_ROW_FIELDS: &[Field] = &[
    field("itemId", &ID),
    field("matchIndex", &INDEX),
    field("matchId", &ID),
    field("playedAt", &ID),
    field("heldEventId", &ID),
    field("matchNoInEvent", &I32),
    field("assetGapFirstToSecond", &Schema::Nullable(&I64)),
    field("assetGapFirstToLast", &Schema::Nullable(&I64)),
    field("totalGinjiCount", &COUNT),
    field("revenueTopMemberIds", &IDS),
    field("winnerMemberId", &NULLABLE_ID),
    field("flags", &MATCH_FLAGS),
    field("qualityStatus", &QUALITY),
];
const MATCH_DIGEST_ROW: Schema = Schema::Object(MATCH_DIGEST_ROW_FIELDS);
const MATCH_DIGEST_ROWS: Schema = Schema::Array {
    item: &MATCH_DIGEST_ROW,
    maximum: 8,
};
const FLAG_COUNTS: Schema = Schema::StringMap(&COUNT);
const MATCH_DIGEST_FIELDS: &[Field] = &[
    field("totalCount", &COUNT),
    field("shownCount", &COUNT),
    field("hiddenCount", &COUNT),
    field("flagCounts", &FLAG_COUNTS),
    field("recent", &MATCH_DIGEST_ROWS),
];
const MATCH_DIGEST: Schema = Schema::Object(MATCH_DIGEST_FIELDS);
const MATCH_NO_PLAYER_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("targetCount", &COUNT),
    field("averageRank", &NULLABLE_NUMBER),
    field("podiumRate", &NULLABLE_RATE),
    field("qualityStatus", &QUALITY),
];
const MATCH_NO_PLAYER: Schema = Schema::Object(MATCH_NO_PLAYER_FIELDS);
const MATCH_NO_PLAYERS: Schema = Schema::Array {
    item: &MATCH_NO_PLAYER,
    maximum: 4,
};
const MATCH_NO_ENTRY_FIELDS: &[Field] = &[
    field("matchNoInEvent", &I32),
    field("category", &Schema::StringEnum(&["regular", "additional"])),
    field("players", &MATCH_NO_PLAYERS),
];
const MATCH_NO_ENTRY: Schema = Schema::Object(MATCH_NO_ENTRY_FIELDS);
const MATCH_NO_ENTRIES: Schema = Schema::Array {
    item: &MATCH_NO_ENTRY,
    maximum: MAX_ITEMS,
};
const MATCH_NO_FIELDS: &[Field] = &[field("entries", &MATCH_NO_ENTRIES)];
const MATCH_NO: Schema = Schema::Object(MATCH_NO_FIELDS);

const FOLD_SCORE_FIELDS: &[Field] = &[
    field("fold", &COUNT),
    field("heldEventCount", &COUNT),
    field("comparisonCount", &COUNT),
    field("baselineLogLoss", &NON_NEGATIVE_NUMBER),
    field("fullLogLoss", &NON_NEGATIVE_NUMBER),
    field("baselineBrierScore", &NON_NEGATIVE_NUMBER),
    field("fullBrierScore", &NON_NEGATIVE_NUMBER),
    field("fullModelImproved", &BOOL),
];
const FOLD_SCORE: Schema = Schema::Object(FOLD_SCORE_FIELDS);
const FOLD_SCORES: Schema = Schema::Array {
    item: &FOLD_SCORE,
    maximum: 5,
};
const SIGNAL_CANDIDATES: Schema = Schema::Array {
    item: &SIGNAL_CANDIDATE,
    maximum: 7,
};
const PLAYER_SIGNALS_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("status", &QUALITY),
    field("candidates", &SIGNAL_CANDIDATES),
];
const PLAYER_SIGNALS: Schema = Schema::Object(PLAYER_SIGNALS_FIELDS);
const PLAYER_SIGNALS_ARRAY: Schema = Schema::Array {
    item: &PLAYER_SIGNALS,
    maximum: 4,
};
const UNEXPECTED_SUMMARY_ROW_FIELDS: &[Field] = &[
    field("matchId", &ID),
    field("heldEventId", &ID),
    field("matchNoInEvent", &I32),
    field("playedAt", &ID),
    field("expectedRank", &NUMBER),
    field("actualRank", &RANK),
    field("evidence", &UNEXPECTED_EVIDENCE),
];
const UNEXPECTED_SUMMARY_ROW: Schema = Schema::Object(UNEXPECTED_SUMMARY_ROW_FIELDS);
const NULLABLE_UNEXPECTED_SUMMARY_ROW: Schema = Schema::Nullable(&UNEXPECTED_SUMMARY_ROW);
const PLAYER_UNEXPECTED_FIELDS: &[Field] = &[
    field("memberId", &ID),
    field("status", &QUALITY),
    field("totalWinCount", &COUNT),
    field("unexpectedWinCount", &COUNT),
    field("latest", &NULLABLE_UNEXPECTED_SUMMARY_ROW),
    field("hasDetails", &BOOL),
];
const PLAYER_UNEXPECTED: Schema = Schema::Object(PLAYER_UNEXPECTED_FIELDS);
const PLAYER_UNEXPECTED_ARRAY: Schema = Schema::Array {
    item: &PLAYER_UNEXPECTED,
    maximum: 4,
};
const CROWN_SHARE_FIELDS: &[Field] = &[field("memberId", &ID), field("share", &RATE)];
const CROWN_SHARE: Schema = Schema::Object(CROWN_SHARE_FIELDS);
const CROWN_SHARES: Schema = Schema::Array {
    item: &CROWN_SHARE,
    maximum: 4,
};
const CROWN_FIELDS: &[Field] = &[
    field("status", &QUALITY),
    field("bootstrapIterations", &COUNT),
    field("successfulIterations", &COUNT),
    field("leaderChangeCount", &COUNT),
    field("shares", &CROWN_SHARES),
];
const CROWN: Schema = Schema::Object(CROWN_FIELDS);
const RANK_ANALYSIS_FIELDS: &[Field] = &[
    field("modelVersion", &Schema::StringEnum(&["rank-bt-v1"])),
    field("status", &QUALITY),
    field("reasonCodes", &REASON_CODES),
    field("heldEventCount", &COUNT),
    field("matchCount", &COUNT),
    field("improvedFoldCount", &COUNT),
    field("requiredImprovedFoldCount", &COUNT),
    field("foldScores", &FOLD_SCORES),
    field("defaultMemberId", &NULLABLE_ID),
    field("rankSignalsByPlayer", &PLAYER_SIGNALS_ARRAY),
    field("unexpectedWinsByPlayer", &PLAYER_UNEXPECTED_ARRAY),
    field("crownCertainty", &CROWN),
];
const RANK_ANALYSIS: Schema = Schema::Object(RANK_ANALYSIS_FIELDS);

const HIGHLIGHT_FIELDS: &[Field] = &[
    field("highlightId", &ID),
    field("metricId", &ID),
    field("leaderMemberIds", &IDS),
    field("value", &NUMBER),
    field("targetCount", &COUNT),
    field("qualityStatus", &QUALITY),
];
const HIGHLIGHT: Schema = Schema::Object(HIGHLIGHT_FIELDS);
const HIGHLIGHTS: Schema = Schema::Array {
    item: &HIGHLIGHT,
    maximum: 4,
};
const METRIC_DEFINITION_FIELDS: &[Field] = &[
    field("metricId", &ID),
    field("label", &ID),
    field(
        "unit",
        &Schema::StringEnum(&["rank", "count", "man_yen", "rate"]),
    ),
    field(
        "preferredDirection",
        &Schema::StringEnum(&["higher", "lower", "contextual"]),
    ),
];
const METRIC_DEFINITION: Schema = Schema::Object(METRIC_DEFINITION_FIELDS);
const METRIC_DEFINITIONS: Schema = Schema::Array {
    item: &METRIC_DEFINITION,
    maximum: 16,
};
const SOURCE_FIELDS: &[Field] = &[field("gameTitleId", &ID)];
const SOURCE: Schema = Schema::Object(SOURCE_FIELDS);

const AGGREGATE_BODY_FIELDS: &[Field] = &[
    field("players", &MEMBER_REFS),
    field("summary", &AGGREGATE_SUMMARY),
    field("metricsByPlayer", &PLAYER_METRICS_ARRAY),
    field("rankDistribution", &RANK_DISTRIBUTIONS),
    field("recentRanks", &RECENT_RANKS),
    field("strategyScatter", &STRATEGY_SCATTER),
    field("playOrderComparison", &PLAY_ORDER_COMPARISONS),
    field("revenueRankConversion", &REVENUE_CONVERSIONS),
    field("trends", &TRENDS),
    field("histograms", &HISTOGRAMS),
    field("headToHead", &HEAD_TO_HEAD),
    field("momentumSwitch", &MOMENTUM_ARRAY),
    field("performanceProfiles", &PERFORMANCE),
    field("assetStyleProfiles", &ASSET_STYLE),
    field("cardShopDestination", &CARD_SHOPS),
    field("matchDigest", &MATCH_DIGEST),
    field("matchNoInEvent", &MATCH_NO),
    field("rankAnalysis", &RANK_ANALYSIS),
    field("highlights", &HIGHLIGHTS),
    field("dataQuality", &DATA_QUALITY),
    field("metricDefinitions", &METRIC_DEFINITIONS),
    field("source", &SOURCE),
];
const V3_RESOURCE_FIELDS: &[Field] = &[field("schemaVersion", &SCHEMA_V3), field("scope", &SCOPE)];
const V1_RESOURCE_FIELDS: &[Field] = &[field("schemaVersion", &SCHEMA_V1), field("scope", &SCOPE)];
const AGGREGATE: Schema = Schema::MergedObject(&[V3_RESOURCE_FIELDS, AGGREGATE_BODY_FIELDS]);
const REVIEW: Schema = Schema::MergedObject(&[V3_RESOURCE_FIELDS, REVIEW_BODY_FIELDS]);
const DRILLDOWN_IDENTITY_FIELDS: &[Field] = &[field("player", &MEMBER_REF)];
const RANK_HISTORY_PAYLOAD_FIELDS: &[Field] = &[field("payload", &RANK_HISTORY)];
const PLAY_ORDER_HISTORY_PAYLOAD_FIELDS: &[Field] = &[field("payload", &PLAY_ORDER_HISTORY)];
const SIGNAL_PAYLOAD_FIELDS: &[Field] = &[field("payload", &SIGNAL_DRILLDOWN)];
const UNEXPECTED_PAYLOAD_FIELDS: &[Field] = &[field("payload", &UNEXPECTED_DRILLDOWN)];
const RANK_HISTORY_RESOURCE: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    DRILLDOWN_IDENTITY_FIELDS,
    RANK_HISTORY_PAYLOAD_FIELDS,
]);
const PLAY_ORDER_HISTORY_RESOURCE: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    DRILLDOWN_IDENTITY_FIELDS,
    PLAY_ORDER_HISTORY_PAYLOAD_FIELDS,
]);
const SIGNAL_RESOURCE: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    DRILLDOWN_IDENTITY_FIELDS,
    SIGNAL_PAYLOAD_FIELDS,
]);
const UNEXPECTED_RESOURCE: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    DRILLDOWN_IDENTITY_FIELDS,
    UNEXPECTED_PAYLOAD_FIELDS,
]);
const CONTEXT_RESOURCE_FIELDS: &[Field] = &[
    field("matchId", &ID),
    field("sourceMatchRevision", &ID),
    field("match", &CONTEXT_MATCH),
];
const CONTEXT_RESOURCE: Schema =
    Schema::MergedObject(&[V1_RESOURCE_FIELDS, CONTEXT_RESOURCE_FIELDS]);

pub(super) fn validate_aggregate(value: &Value) -> Result<(), PayloadError> {
    validate(value, &AGGREGATE)
}

pub(super) fn validate_review(value: &Value) -> Result<(), PayloadError> {
    validate(value, &REVIEW)
}

pub(super) fn validate_drilldown(value: &Value, metric_id: &str) -> Result<(), PayloadError> {
    let schema = match metric_id {
        "rank.averageHistory" => &RANK_HISTORY_RESOURCE,
        "playOrder.rankHistory" => &PLAY_ORDER_HISTORY_RESOURCE,
        "rankAnalysis.rankSignals" => &SIGNAL_RESOURCE,
        "rankAnalysis.unexpectedWins" => &UNEXPECTED_RESOURCE,
        _ => return Err(PayloadError::IdentityMismatch),
    };
    validate(value, schema)
}

pub(super) fn validate_match_context(value: &Value) -> Result<(), PayloadError> {
    validate(value, &CONTEXT_RESOURCE)
}

fn validate_selected(
    object: &serde_json::Map<String, Value>,
    fields: &[Field],
) -> Result<(), PayloadError> {
    for field in fields {
        validate(
            object.get(field.name).ok_or(PayloadError::InvalidSchema)?,
            field.schema,
        )?;
    }
    Ok(())
}

fn validate(value: &Value, schema: &Schema) -> Result<(), PayloadError> {
    match schema {
        Schema::Bool => value
            .as_bool()
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::ExactUnsigned(expected) => (value.as_u64() == Some(*expected))
            .then_some(())
            .ok_or(PayloadError::InvalidSchema),
        Schema::Integer { minimum, maximum } => value
            .as_i64()
            .filter(|number| number >= minimum && number <= maximum)
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::Unsigned { maximum } => value
            .as_u64()
            .filter(|number| number <= maximum)
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::Number => value
            .as_f64()
            .filter(|number| number.is_finite())
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::NumberRange { minimum, maximum } => value
            .as_f64()
            .filter(|number| number.is_finite() && number >= minimum && number <= maximum)
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::String { non_empty } => value
            .as_str()
            .filter(|text| text.len() <= MAX_TEXT_BYTES && (!non_empty || !text.is_empty()))
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::StringEnum(allowed) => value
            .as_str()
            .filter(|text| allowed.contains(text))
            .map(|_| ())
            .ok_or(PayloadError::InvalidSchema),
        Schema::Nullable(inner) => {
            if value.is_null() {
                Ok(())
            } else {
                validate(value, inner)
            }
        }
        Schema::Array { item, maximum } => {
            let values = value.as_array().ok_or(PayloadError::InvalidSchema)?;
            if values.len() > *maximum {
                return Err(PayloadError::InvalidSchema);
            }
            values.iter().try_for_each(|entry| validate(entry, item))
        }
        Schema::Tuple(items) => {
            let values = value.as_array().ok_or(PayloadError::InvalidSchema)?;
            if values.len() != items.len() {
                return Err(PayloadError::InvalidSchema);
            }
            values
                .iter()
                .zip(*items)
                .try_for_each(|(entry, item)| validate(entry, item))
        }
        Schema::Object(fields) => validate_object(value, fields),
        Schema::MergedObject(field_sets) => validate_merged_object(value, field_sets),
        Schema::StringMap(item) => validate_string_map(value, item),
        Schema::OneOf(options) => validate_one_of(value, options),
    }
}

fn validate_object(value: &Value, fields: &[Field]) -> Result<(), PayloadError> {
    let object = value.as_object().ok_or(PayloadError::InvalidSchema)?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(field.name)) {
        return Err(PayloadError::InvalidSchema);
    }
    validate_selected(object, fields)
}

fn validate_merged_object(value: &Value, field_sets: &[&[Field]]) -> Result<(), PayloadError> {
    let object = value.as_object().ok_or(PayloadError::InvalidSchema)?;
    let expected_count = field_sets.iter().map(|fields| fields.len()).sum::<usize>();
    if object.len() != expected_count
        || field_sets
            .iter()
            .flat_map(|fields| fields.iter())
            .any(|field| !object.contains_key(field.name))
    {
        return Err(PayloadError::InvalidSchema);
    }
    field_sets
        .iter()
        .try_for_each(|fields| validate_selected(object, fields))
}

fn validate_string_map(value: &Value, item: &Schema) -> Result<(), PayloadError> {
    let object = value.as_object().ok_or(PayloadError::InvalidSchema)?;
    if object.len() > MAX_ITEMS
        || object
            .keys()
            .any(|key| key.is_empty() || key.len() > MAX_TEXT_BYTES)
    {
        return Err(PayloadError::InvalidSchema);
    }
    object.values().try_for_each(|entry| validate(entry, item))
}

fn validate_one_of(value: &Value, options: &[&Schema]) -> Result<(), PayloadError> {
    let matches = options
        .iter()
        .filter(|candidate| validate(value, candidate).is_ok())
        .count();
    (matches == 1)
        .then_some(())
        .ok_or(PayloadError::InvalidSchema)
}
