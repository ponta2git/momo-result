//! Bounded saved facts used by the rank outlook. Scenario inputs are never persisted here.

use super::{ID, OVERALL_SCOPE, QUALITY, SCHEMA_V1, SEASON_SCOPE, Schema, field};

const MATCH_COUNT: Schema = Schema::Unsigned { maximum: 25_000 };
const RANK_SUM: Schema = Schema::Unsigned { maximum: 100_000 };
const AVERAGE: Schema = Schema::NumberRange {
    minimum: 1.0,
    maximum: 4.0,
};
const RECENT_COUNT: Schema = Schema::Unsigned { maximum: 20 };
const WINDOW_SIZE: Schema = Schema::Integer {
    minimum: 1,
    maximum: 1_000,
};
const SEQUENCE: Schema = Schema::Integer {
    minimum: 1,
    maximum: 25_000,
};
const TIMESTAMP: Schema = Schema::String { non_empty: true };
const RANK_COUNTS: Schema =
    Schema::Tuple(&[&RECENT_COUNT, &RECENT_COUNT, &RECENT_COUNT, &RECENT_COUNT]);
const JOINT_COUNTS: Schema =
    Schema::Tuple(&[&RANK_COUNTS, &RANK_COUNTS, &RANK_COUNTS, &RANK_COUNTS]);

const PERIOD: Schema = Schema::Object(&[
    field("startMatchId", &ID),
    field("endMatchId", &ID),
    field("startedAt", &TIMESTAMP),
    field("endedAt", &TIMESTAMP),
    field("startSequence", &SEQUENCE),
    field("endSequence", &SEQUENCE),
]);
const NULLABLE_PERIOD: Schema = Schema::Nullable(&PERIOD);
const WINDOW: Schema = Schema::Object(&[
    field("windowSize", &WINDOW_SIZE),
    field("rankSum", &RANK_SUM),
    field("averageRank", &AVERAGE),
    field("period", &PERIOD),
]);
const NULLABLE_WINDOW: Schema = Schema::Nullable(&WINDOW);
const SOURCE: Schema = Schema::Object(&[
    field("gameTitleId", &ID),
    field("titleMatchCount", &MATCH_COUNT),
]);
const PLAYER: Schema = Schema::Object(&[
    field("memberId", &ID),
    field("rankSum", &RANK_SUM),
    field("averageRank", &AVERAGE),
]);
const PLAYERS: Schema = Schema::Array {
    item: &PLAYER,
    maximum: 4,
};
const RECENT_PLAYER: Schema = Schema::Object(&[
    field("memberId", &ID),
    field("rankCounts", &RANK_COUNTS),
    field("rankSum", &RANK_SUM),
    field("averageRank", &AVERAGE),
]);
const RECENT_PLAYERS: Schema = Schema::Array {
    item: &RECENT_PLAYER,
    maximum: 4,
};
const JOINT: Schema = Schema::Object(&[
    field("memberAId", &ID),
    field("memberBId", &ID),
    field("rankCounts", &JOINT_COUNTS),
]);
const JOINTS: Schema = Schema::Array {
    item: &JOINT,
    maximum: 6,
};
const RECENT: Schema = Schema::Object(&[
    field("matchCount", &RECENT_COUNT),
    field("qualityStatus", &QUALITY),
    field("period", &NULLABLE_PERIOD),
    field("players", &RECENT_PLAYERS),
    field("jointRanks", &JOINTS),
]);
const AVAILABILITY: Schema = Schema::StringEnum(&["available", "insufficient"]);
const BEST_PREVIEW: Schema = Schema::Object(&[
    field("memberId", &ID),
    field("windowSize", &WINDOW_SIZE),
    field("status", &AVAILABILITY),
    field("window", &NULLABLE_WINDOW),
]);
const BEST_PREVIEWS: Schema = Schema::Array {
    item: &BEST_PREVIEW,
    maximum: 8,
};
const SUMMARY_SCOPE: Schema = Schema::OneOf(&[&OVERALL_SCOPE, &SEASON_SCOPE]);

pub(super) const SUMMARY: Schema = Schema::Object(&[
    field("schemaVersion", &SCHEMA_V1),
    field("scope", &SUMMARY_SCOPE),
    field("source", &SOURCE),
    field("qualityStatus", &QUALITY),
    field("period", &NULLABLE_PERIOD),
    field("players", &PLAYERS),
    field("recent", &RECENT),
    field("bestWindows", &BEST_PREVIEWS),
]);

const BEST_WINDOWS: Schema = Schema::Array {
    item: &WINDOW,
    maximum: 1_000,
};
const EXAMPLE: Schema =
    Schema::Object(&[field("rankCounts", &RANK_COUNTS), field("window", &WINDOW)]);
const EXAMPLES: Schema = Schema::Object(&[
    field("status", &AVAILABILITY),
    field(
        "types",
        &Schema::Array {
            item: &EXAMPLE,
            maximum: 1_771,
        },
    ),
]);
pub(super) const REFERENCE: Schema = Schema::Object(&[
    field("schemaVersion", &SCHEMA_V1),
    field("scope", &OVERALL_SCOPE),
    field("source", &SOURCE),
    field("memberId", &ID),
    field("recentRankCounts", &RANK_COUNTS),
    field("bestWindows", &BEST_WINDOWS),
    field("examples", &EXAMPLES),
]);
