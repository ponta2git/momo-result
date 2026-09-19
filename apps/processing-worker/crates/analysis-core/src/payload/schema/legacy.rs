//! Immutable reader shapes are exported only in tests; the producer owns the current format.
use super::*;

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

const LEGACY_METRIC_FIELDS: &[Field] = &[field("metricDefinitions", &METRIC_DEFINITIONS)];
pub(super) const AGGREGATE_V3: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    AGGREGATE_BODY_FIELDS,
    LEGACY_METRIC_FIELDS,
]);
pub(super) const AGGREGATE_V4: Schema = Schema::MergedObject(&[
    V4_RESOURCE_FIELDS,
    AGGREGATE_BODY_FIELDS,
    OWNER_FIELDS,
    LEGACY_METRIC_FIELDS,
]);
const LEGACY_CARD: Schema = Schema::MergedObject(&[CARD_FIELDS, &[field("anchorTarget", &ANCHOR)]]);
const LEGACY_PLAYBOOK: Schema = Schema::Object(&[
    field("player", &MEMBER_REF),
    field("primaryCard", &Schema::Nullable(&LEGACY_CARD)),
    field(
        "secondaryCards",
        &Schema::Array {
            item: &LEGACY_CARD,
            maximum: 2,
        },
    ),
]);
pub(super) const REVIEW_V3: Schema = Schema::MergedObject(&[
    V3_RESOURCE_FIELDS,
    &[
        field("baseline", &BASELINE),
        field("commonPlaybookTopics", &COMMON_TOPICS),
        field(
            "playbookByPlayer",
            &Schema::Array {
                item: &LEGACY_PLAYBOOK,
                maximum: 4,
            },
        ),
        field("dataQuality", &DATA_QUALITY),
    ],
]);
