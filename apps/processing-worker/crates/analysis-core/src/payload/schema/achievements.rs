use super::{BOOL, ID, NULLABLE_ID, Schema, field};

const LIMIT: usize = crate::achievements::MAXIMUM_ITEMS;
const POINTS: Schema = Schema::Unsigned { maximum: 102_400 };
const SCORE: Schema = Schema::NumberRange {
    minimum: 1.0,
    maximum: 10.0,
};
const NULLABLE_SCORE: Schema = Schema::Nullable(&SCORE);
const PERCENTAGE: Schema = Schema::NumberRange {
    minimum: 0.0,
    maximum: 100.0,
};
pub(super) const CURVE: Schema =
    Schema::Object(&[field("thresholds", &Schema::Tuple(&[&PERCENTAGE; 5]))]);
const STARS: Schema = Schema::Integer {
    minimum: 1,
    maximum: 5,
};
const SCOPE: Schema = Schema::Object(&[field("kind", &Schema::StringEnum(&["overall"]))]);
const MAPS: Schema = Schema::Array {
    item: &ID,
    maximum: LIMIT,
};
const PROOF: Schema = Schema::Object(&[
    field(
        "kind",
        &Schema::StringEnum(&["manual", "import", "derived", "automatic"]),
    ),
    field("state", &Schema::StringEnum(&["achieved", "unconfirmed"])),
    field("claimId", &NULLABLE_ID),
    field("generationId", &NULLABLE_ID),
    field("sourceAchievementId", &NULLABLE_ID),
    field("matchId", &NULLABLE_ID),
    field("heldEventId", &NULLABLE_ID),
    field("achievedAt", &NULLABLE_ID),
]);
const PROOFS: Schema = Schema::Array {
    item: &PROOF,
    maximum: crate::achievements::MAXIMUM_PROOFS,
};
const PLAYER: Schema = Schema::Object(&[
    field("memberId", &ID),
    field(
        "status",
        &Schema::StringEnum(&["achieved", "unconfirmed", "not_recorded"]),
    ),
    field("firstAchievedAt", &NULLABLE_ID),
    field("dateUnknown", &BOOL),
    field("proofs", &PROOFS),
]);
const PLAYERS: Schema = Schema::Tuple(&[&PLAYER, &PLAYER, &PLAYER, &PLAYER]);
const ITEM: Schema = Schema::Object(&[
    field("achievementId", &ID),
    field("stars", &STARS),
    field(
        "ruleKind",
        &Schema::StringEnum(&[
            "manual",
            "total_assets",
            "destination",
            "suri_no_ginji",
            "event_average_rank",
        ]),
    ),
    field("threshold", &NULLABLE_ID),
    field("common", &BOOL),
    field("mapMasterIds", &MAPS),
    field("appliesFrom", &NULLABLE_ID),
    field("retired", &BOOL),
    field("players", &PLAYERS),
]);
const ITEMS: Schema = Schema::Array {
    item: &ITEM,
    maximum: LIMIT,
};
const PLAYER_POINTS: Schema = Schema::Object(&[
    field("memberId", &ID),
    field("earnedPoints", &POINTS),
    field("score", &NULLABLE_SCORE),
]);
const POINT_PLAYERS: Schema = Schema::Tuple(&[
    &PLAYER_POINTS,
    &PLAYER_POINTS,
    &PLAYER_POINTS,
    &PLAYER_POINTS,
]);
const SUMMARY: Schema = Schema::Object(&[
    field("mapMasterId", &NULLABLE_ID),
    field("totalPoints", &POINTS),
    field("players", &POINT_PLAYERS),
]);
const SUMMARIES: Schema = Schema::Array {
    item: &SUMMARY,
    maximum: LIMIT + 1,
};
#[cfg(test)]
pub(super) const PREVIEW: Schema = Schema::Object(&[
    field("achievementCurve", &CURVE),
    field("summary", &SUMMARY),
]);
pub(super) const ACHIEVEMENTS: Schema = Schema::Object(&[
    field("schemaVersion", &Schema::ExactUnsigned(2)),
    field("scope", &SCOPE),
    field("gameTitleId", &ID),
    field("achievementCurve", &CURVE),
    field("items", &ITEMS),
    field("summaries", &SUMMARIES),
]);
