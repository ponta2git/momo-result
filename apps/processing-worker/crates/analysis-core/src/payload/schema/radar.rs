use super::{COUNT, Field, ID, NULLABLE_ID, NULLABLE_NUMBER, NUMBER, Schema, field};

const AXIS: Schema = Schema::StringEnum(&[
    "averageRank",
    "revenueP90",
    "revenueAverage",
    "totalAssetsP10",
    "totalAssetsMedian",
    "totalAssetsP90",
]);
const DEFINITION: Schema = Schema::StringEnum(&[crate::radar::RADAR_DEFINITION_VERSION]);
const METHOD: Schema = Schema::StringEnum(&[crate::radar::RADAR_METHOD_VERSION]);
const MATCH_ORDER: Schema = Schema::Object(&[
    field("playedAt", &ID),
    field("heldEventId", &ID),
    field(
        "matchNoInEvent",
        &Schema::Integer {
            minimum: 1,
            maximum: 2_147_483_647,
        },
    ),
    field("matchId", &ID),
]);
const NULLABLE_MATCH_ORDER: Schema = Schema::Nullable(&MATCH_ORDER);
const MAP_COUNT: Schema = Schema::Object(&[field("mapMasterId", &ID), field("matchCount", &COUNT)]);
const MAP_COUNTS: Schema = Schema::Array {
    item: &MAP_COUNT,
    maximum: 25_000,
};
const MAP_IDS: Schema = Schema::Array {
    item: &ID,
    maximum: 25_000,
};
const SOURCE: Schema = Schema::Object(&[
    field("gameTitleId", &ID),
    field("sourceChecksum", &ID),
    field("matchCount", &COUNT),
    field("heldEventCount", &COUNT),
    field("firstMatch", &NULLABLE_MATCH_ORDER),
    field("lastMatch", &NULLABLE_MATCH_ORDER),
    field("mapMasterIds", &MAP_IDS),
    field("mapCounts", &MAP_COUNTS),
]);
const THRESHOLDS: Schema = Schema::Tuple(&[&NUMBER; 9]);
const AXIS_BASIS: Schema = Schema::Object(&[
    field("axisId", &AXIS),
    field("q10", &NUMBER),
    field("median", &NUMBER),
    field("q90", &NUMBER),
    field("thresholds", &THRESHOLDS),
]);
pub(super) const BASIS: Schema = Schema::Object(&[
    field("definitionVersion", &DEFINITION),
    field("methodVersion", &METHOD),
    field("windowSize", &Schema::ExactUnsigned(20)),
    field("windowStride", &Schema::ExactUnsigned(1)),
    field("source", &SOURCE),
    field("axes", &Schema::Tuple(&[&AXIS_BASIS; 6])),
]);
const NULLABLE_BASIS: Schema = Schema::Nullable(&BASIS);
const PUBLISHED_BASIS: Schema = Schema::Object(&[
    field("basisId", &ID),
    field("checksum", &ID),
    field("basis", &BASIS),
]);
const QUALITY: Schema = Schema::StringEnum(&["no_target", "insufficient", "reference", "standard"]);
const SAMPLE: Schema = Schema::Object(&[
    field("matchCount", &COUNT),
    field("heldEventCount", &COUNT),
    field("quality", &QUALITY),
    field("firstMatch", &NULLABLE_MATCH_ORDER),
    field("lastMatch", &NULLABLE_MATCH_ORDER),
    field("mapCounts", &MAP_COUNTS),
]);
const SCORE: Schema = Schema::Integer {
    minimum: 1,
    maximum: 10,
};
const UNAVAILABLE: Schema =
    Schema::StringEnum(&["no_target", "insufficient_matches", "basis_unavailable"]);
const CELL: Schema = Schema::Object(&[
    field("axisId", &AXIS),
    field("rawValue", &NULLABLE_NUMBER),
    field("score", &Schema::Nullable(&SCORE)),
    field("sampleQuality", &QUALITY),
    field(
        "scoreUnavailableReasons",
        &Schema::Array {
            item: &UNAVAILABLE,
            maximum: 2,
        },
    ),
]);
const PLAYER: Schema = Schema::Object(&[
    field("memberId", &ID),
    field("axes", &Schema::Tuple(&[&CELL; 6])),
]);
pub(super) const EVALUATION: Schema = Schema::Object(&[
    field("definitionVersion", &DEFINITION),
    field("methodVersion", &METHOD),
    field("basisChecksum", &NULLABLE_ID),
    field("sample", &SAMPLE),
    field(
        "players",
        &Schema::Array {
            item: &PLAYER,
            maximum: 4,
        },
    ),
]);
pub(super) const AGGREGATE: Schema = Schema::Object(&[
    field("basis", &Schema::Nullable(&PUBLISHED_BASIS)),
    field("evaluation", &EVALUATION),
    field("monitoring", &Schema::Nullable(&MONITORING)),
]);
const CANDIDATE_UNAVAILABLE: Schema = Schema::StringEnum(&[
    "insufficient_matches",
    "insufficient_events",
    "degenerate_distribution",
]);
const CANDIDATE_AXIS: Schema = Schema::Object(&[
    field("axisId", &AXIS),
    field("q10", &NULLABLE_NUMBER),
    field("median", &NULLABLE_NUMBER),
    field("q90", &NULLABLE_NUMBER),
    field("thresholds", &Schema::Nullable(&THRESHOLDS)),
    field(
        "unavailableReasons",
        &Schema::Array {
            item: &CANDIDATE_UNAVAILABLE,
            maximum: 2,
        },
    ),
]);
pub(super) const CANDIDATE: Schema = Schema::Object(&[
    field("sourceSummary", &SOURCE),
    field("windowCount", &COUNT),
    field("valuesPerAxis", &COUNT),
    field("axes", &Schema::Tuple(&[&CANDIDATE_AXIS; 6])),
    field("basis", &NULLABLE_BASIS),
]);
const REVIEW_REASON: Schema = Schema::Object(&[
    field(
        "kind",
        &Schema::StringEnum(&[
            "initial_basis_eligible",
            "source_changed",
            "new_map",
            "high_score_concentration",
        ]),
    ),
    field(
        "axisIds",
        &Schema::Array {
            item: &AXIS,
            maximum: 6,
        },
    ),
    field("mapMasterIds", &MAP_IDS),
    field("evidenceChecksum", &ID),
]);
const MONITORING_WINDOW: Schema = Schema::Object(&[
    field("firstMatch", &MATCH_ORDER),
    field("lastMatch", &MATCH_ORDER),
    field("evaluation", &EVALUATION),
]);
pub(super) const MONITORING: Schema = Schema::Object(&[
    field(
        "status",
        &Schema::StringEnum(&[
            "basis_unavailable",
            "insufficient_matches",
            "insufficient_events",
            "ready",
        ]),
    ),
    field("postSourceMatchCount", &COUNT),
    field("completedWindowCount", &COUNT),
    field("pendingMatchCount", &Schema::Unsigned { maximum: 19 }),
    field("evaluatedMatchCount", &COUNT),
    field("evaluatedHeldEventCount", &COUNT),
    field(
        "latestWindows",
        &Schema::Array {
            item: &MONITORING_WINDOW,
            maximum: 2,
        },
    ),
    field(
        "reasons",
        &Schema::Array {
            item: &REVIEW_REASON,
            maximum: 4,
        },
    ),
]);

pub(super) const RESOURCE_FIELD: Field = field("playerRadar", &AGGREGATE);
