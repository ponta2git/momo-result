#![expect(
    clippy::expect_used,
    clippy::panic,
    reason = "static contract fixtures must be valid before exercising completion validation"
)]

use serde_json::{Value as JsonValue, json};

use super::*;
use crate::ocr::contract::OcrMediaType;

#[test]
fn control_configuration_requires_a_lease_safety_margin() {
    assert!(
        OcrControlConfig::new(
            String::from("ocr-worker-1"),
            Duration::from_mins(1),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_ok()
    );
    assert!(
        OcrControlConfig::new(
            String::from("bad worker"),
            Duration::from_mins(1),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_err()
    );
    assert!(
        OcrControlConfig::new(
            String::from("ocr-worker-1"),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_err()
    );
}

#[test]
fn failure_vocabulary_stays_compatible_with_the_api_contract() {
    let values = [
        (
            OcrFailureCode::TempImageMissing,
            "TEMP_IMAGE_MISSING",
            false,
        ),
        (OcrFailureCode::InvalidImage, "INVALID_IMAGE", false),
        (
            OcrFailureCode::UnsupportedImageFormat,
            "UNSUPPORTED_IMAGE_FORMAT",
            false,
        ),
        (OcrFailureCode::DecodeFailed, "DECODE_FAILED", false),
        (
            OcrFailureCode::CategoryUndetected,
            "CATEGORY_UNDETECTED",
            false,
        ),
        (
            OcrFailureCode::LayoutUnsupported,
            "LAYOUT_UNSUPPORTED",
            false,
        ),
        (OcrFailureCode::OcrTimeout, "OCR_TIMEOUT", true),
        (
            OcrFailureCode::OcrEngineUnavailable,
            "OCR_ENGINE_UNAVAILABLE",
            true,
        ),
        (OcrFailureCode::ParserFailed, "PARSER_FAILED", false),
        (OcrFailureCode::QueueFailure, "QUEUE_FAILURE", false),
    ];
    for (failure, wire, retryable) in values {
        assert_eq!(failure.wire(), wire);
        assert_eq!(failure.retryable(), retryable);
    }
}

#[test]
fn completion_requires_the_claimed_screen_and_its_exact_profile() {
    for (screen, profile) in [
        (RequestedScreenType::TotalAssets, "full-hd-total-assets-v1"),
        (RequestedScreenType::Revenue, "full-hd-revenue-v1"),
        (RequestedScreenType::IncidentLog, "full-hd-incident-log-v1"),
    ] {
        assert_eq!(screen.expected_profile_id(), profile);
        let claim = valid_claim(screen);
        assert!(
            validate_completion(&claim, &OcrHints::default(), &valid_completion(screen)).is_ok()
        );
    }

    let claim = valid_claim(RequestedScreenType::TotalAssets);
    let mut cross_screen = valid_completion(RequestedScreenType::TotalAssets);
    cross_screen.output.detected_screen_type = RequestedScreenType::Revenue;
    assert_invalid_completion(&claim, &cross_screen);

    let mut wrong_profile = valid_completion(RequestedScreenType::TotalAssets);
    wrong_profile.output.profile_id = Some(String::from("full-hd-revenue-v1"));
    assert_invalid_completion(&claim, &wrong_profile);

    let mut missing_profile = valid_completion(RequestedScreenType::TotalAssets);
    missing_profile.output.profile_id = None;
    assert_invalid_completion(&claim, &missing_profile);
}

#[test]
fn completion_requires_coherent_payload_discriminators_and_profile() {
    let claim = valid_claim(RequestedScreenType::TotalAssets);

    for (field, mismatch) in [
        ("requested_screen_type", json!("revenue")),
        ("detected_screen_type", json!("revenue")),
        ("profile_id", json!("full-hd-revenue-v1")),
    ] {
        let mut completion = valid_completion(RequestedScreenType::TotalAssets);
        replace_json_pointer(
            &mut completion.output.payload,
            &format!("/{field}"),
            mismatch,
        );
        assert_invalid_completion(&claim, &completion);
    }

    let mut wrong_parser = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut wrong_parser.output.payload,
        "/category_payload/parser",
        json!("revenue"),
    );
    assert_invalid_completion(&claim, &wrong_parser);
}

#[test]
fn completion_requires_closed_typed_and_observationally_coherent_payloads() {
    let claim = valid_claim(RequestedScreenType::TotalAssets);

    let mut open_payload = valid_completion(RequestedScreenType::TotalAssets);
    open_payload
        .output
        .payload
        .as_object_mut()
        .expect("payload fixture is an object")
        .insert(String::from("unexpected"), JsonValue::Null);
    assert_invalid_completion(&claim, &open_payload);

    let mut missing_players = valid_completion(RequestedScreenType::TotalAssets);
    missing_players
        .output
        .payload
        .as_object_mut()
        .expect("payload fixture is an object")
        .remove("players");
    assert_invalid_completion(&claim, &missing_players);

    let mut open_player = valid_completion(RequestedScreenType::TotalAssets);
    open_player
        .output
        .payload
        .pointer_mut("/players/0")
        .and_then(JsonValue::as_object_mut)
        .expect("first player fixture is an object")
        .insert(String::from("unexpected"), JsonValue::Null);
    assert_invalid_completion(&claim, &open_player);

    let mut incoherent_amount = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut incoherent_amount.output.payload,
        "/category_payload/rows/0/amount_man_yen",
        json!(999),
    );
    assert_invalid_completion(&claim, &incoherent_amount);

    let mut missing_observation_source = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut missing_observation_source.output.payload,
        "/players/0/total_assets_man_yen/raw_text",
        JsonValue::Null,
    );
    assert_invalid_completion(&claim, &missing_observation_source);

    let mut invalid_confidence = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut invalid_confidence.output.payload,
        "/players/0/total_assets_man_yen/confidence",
        json!(1.1),
    );
    assert_invalid_completion(&claim, &invalid_confidence);
}

#[test]
fn completion_requires_closed_bounded_coherent_warnings() {
    let claim = valid_claim(RequestedScreenType::TotalAssets);
    let valid = completion_with_missing_amount_warning();
    assert!(validate_completion(&claim, &OcrHints::default(), &valid).is_ok());

    let mut legacy_string = valid_completion(RequestedScreenType::TotalAssets);
    legacy_string.output.warnings = json!(["ambiguous"]);
    let legacy_warnings = legacy_string.output.warnings.clone();
    replace_json_pointer(
        &mut legacy_string.output.payload,
        "/warnings",
        legacy_warnings,
    );
    assert_invalid_completion(&claim, &legacy_string);

    let mut open_warning = completion_with_missing_amount_warning();
    open_warning.output.warnings = json!([{
        "code": "MISSING_AMOUNT",
        "message": "OCR confidence was low.",
        "severity": "warning",
        "field_path": "players[0].total_assets_man_yen",
        "unexpected": true,
    }]);
    let open_warnings = open_warning.output.warnings.clone();
    replace_json_pointer(&mut open_warning.output.payload, "/warnings", open_warnings);
    assert_invalid_completion(&claim, &open_warning);

    let mut incoherent = valid_completion(RequestedScreenType::TotalAssets);
    incoherent.output.warnings = json!([structured_warning()]);
    assert_invalid_completion(&claim, &incoherent);

    let mut oversized = completion_with_missing_amount_warning();
    oversized.output.warnings = json!([{
        "code": "MISSING_AMOUNT",
        "message": "x".repeat(MAXIMUM_DRAFT_JSON_BYTES),
        "severity": "warning",
        "field_path": "players[0].total_assets_man_yen",
    }]);
    let oversized_warnings = oversized.output.warnings.clone();
    replace_json_pointer(
        &mut oversized.output.payload,
        "/warnings",
        oversized_warnings,
    );
    assert_invalid_completion(&claim, &oversized);
}

#[test]
fn completion_cross_checks_player_order_member_ids_and_warning_references() {
    let claim = valid_claim(RequestedScreenType::TotalAssets);

    let mut forged_play_order = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut forged_play_order.output.payload,
        "/players/0/play_order",
        ocr_field(&json!(1), &json!("player-1"), &json!(1.0)),
    );
    assert_invalid_completion(&claim, &forged_play_order);

    let mut duplicate_category_order = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut duplicate_category_order.output.payload,
        "/category_payload/player_order/slots/1/play_order",
        json!(1),
    );
    assert_invalid_completion(&claim, &duplicate_category_order);

    let mut unknown_member = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut unknown_member.output.payload,
        "/players/0/member_id",
        json!("member-forged"),
    );
    assert_invalid_completion(&claim, &unknown_member);

    let hints: OcrHints = serde_json::from_value(json!({
        "knownPlayerAliases": [
            {"memberId": "member-known", "aliases": ["player-1"]},
            {"memberId": "member-other", "aliases": ["zebra-president"]}
        ]
    }))
    .expect("static hints must satisfy the closed schema");
    let mut known_member = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut known_member.output.payload,
        "/players/0/member_id",
        json!("member-known"),
    );
    assert!(validate_completion(&claim, &hints, &known_member).is_ok());

    let mut mismatched_member = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut mismatched_member.output.payload,
        "/players/0/member_id",
        json!("member-other"),
    );
    assert!(validate_completion(&claim, &hints, &mismatched_member).is_err());

    let mut wrong_warning_path = completion_with_missing_amount_warning();
    replace_json_pointer(
        &mut wrong_warning_path.output.warnings,
        "/0/field_path",
        json!("players[3].total_assets_man_yen"),
    );
    let warnings = wrong_warning_path.output.warnings.clone();
    replace_json_pointer(
        &mut wrong_warning_path.output.payload,
        "/warnings",
        warnings,
    );
    assert_invalid_completion(&claim, &wrong_warning_path);
}

#[test]
fn completion_requires_exact_finite_nonnegative_sensible_timings() {
    let claim = valid_claim(RequestedScreenType::TotalAssets);

    let mut missing_key = valid_completion(RequestedScreenType::TotalAssets);
    missing_key
        .output
        .timings_milliseconds
        .as_object_mut()
        .expect("timing fixture is an object")
        .remove("parse");
    assert_invalid_completion(&claim, &missing_key);

    let mut extra_key = valid_completion(RequestedScreenType::TotalAssets);
    extra_key
        .output
        .timings_milliseconds
        .as_object_mut()
        .expect("timing fixture is an object")
        .insert(String::from("unexpected"), json!(0.0));
    assert_invalid_completion(&claim, &extra_key);

    let mut negative = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut negative.output.timings_milliseconds,
        "/decode",
        json!(-1.0),
    );
    assert_invalid_completion(&claim, &negative);

    let mut non_numeric = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut non_numeric.output.timings_milliseconds,
        "/decode",
        json!("1.0"),
    );
    assert_invalid_completion(&claim, &non_numeric);

    let mut inconsistent_total = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut inconsistent_total.output.timings_milliseconds,
        "/total",
        json!(3.0),
    );
    assert_invalid_completion(&claim, &inconsistent_total);

    let mut beyond_parent_elapsed = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut beyond_parent_elapsed.output.timings_milliseconds,
        "/total",
        json!(8.0),
    );
    assert_invalid_completion(&claim, &beyond_parent_elapsed);
}

fn valid_claim(requested_screen_type: RequestedScreenType) -> ClaimedOcrJob {
    ClaimedOcrJob {
        job_id: String::from("ocr-job-1"),
        draft_id: String::from("ocr-draft-1"),
        source_image: SourceImageClaims::new(
            String::from("source-images/ocr-job-1.png"),
            "ab".repeat(32),
            68,
            OcrMediaType::Png,
        )
        .expect("static source-image claims are valid"),
        expected_width: 1920,
        expected_height: 1080,
        requested_screen_type,
        attempt_id: String::from("00000000-0000-4000-8000-000000000001"),
        lease_token: String::from("00000000-0000-4000-8000-000000000002"),
        attempt_count: 1,
        fencing_token: 1,
    }
}

pub(super) fn valid_completion(screen: RequestedScreenType) -> OcrDraftCompletion {
    let wire = screen.wire();
    let profile = screen.expected_profile_id();
    let player_order = player_order_fixture();
    let (players, category_payload) = payload_fixture(screen, &player_order);
    OcrDraftCompletion {
        output: OcrOutput {
            detected_screen_type: screen,
            profile_id: Some(String::from(profile)),
            payload: json!({
                "requested_screen_type": wire,
                "detected_screen_type": wire,
                "profile_id": profile,
                "players": players,
                "category_payload": category_payload,
                "warnings": [],
                "raw_snippets": null,
            }),
            warnings: json!([]),
            timings_milliseconds: json!({
                "decode": 1.0,
                "engine_initialization": 1.0,
                "detect_player_order": 1.0,
                "parse": 1.0,
                "total": 5.0,
            }),
        },
        duration_milliseconds: 6,
    }
}

fn payload_fixture(
    screen: RequestedScreenType,
    player_order: &JsonValue,
) -> (Vec<JsonValue>, JsonValue) {
    match screen {
        RequestedScreenType::TotalAssets | RequestedScreenType::Revenue => {
            ranked_payload_fixture(screen, player_order)
        }
        RequestedScreenType::IncidentLog => incident_payload_fixture(player_order),
    }
}

fn ranked_payload_fixture(
    screen: RequestedScreenType,
    player_order: &JsonValue,
) -> (Vec<JsonValue>, JsonValue) {
    let players = (1_u8..=4)
        .map(|rank| {
            let amount = json!(i64::from(rank) * 100);
            let selected = ocr_field(&amount, &json!("1億円"), &json!(0.9));
            let empty_money = empty_ocr_field();
            let (total_assets, revenue) = if screen == RequestedScreenType::TotalAssets {
                (selected, empty_money)
            } else {
                (empty_money, selected)
            };
            let player_name = json!(format!("player-{rank}"));
            json!({
                "raw_player_name": ocr_field(&player_name, &player_name, &json!(0.9)),
                "member_id": null,
                "play_order": empty_ocr_field(),
                "rank": ocr_field(&json!(rank), &json!(rank.to_string()), &json!(1.0)),
                "total_assets_man_yen": total_assets,
                "revenue_man_yen": revenue,
                "incidents": {},
            })
        })
        .collect::<Vec<_>>();
    let rows = (1_u8..=4)
        .map(|rank| {
            json!({
                "rank": rank,
                "raw_player_name": format!("player-{rank}"),
                "amount_man_yen": i64::from(rank) * 100,
                "confidence": 0.9,
                "warnings": [],
            })
        })
        .collect::<Vec<_>>();
    (
        players,
        json!({
            "status": "parsed",
            "parser": screen.wire(),
            "rows": rows,
            "player_order": player_order,
            "include_raw_text": false,
        }),
    )
}

fn incident_payload_fixture(player_order: &JsonValue) -> (Vec<JsonValue>, JsonValue) {
    let players = ["blue", "red", "yellow", "green"]
        .into_iter()
        .enumerate()
        .map(|(index, color)| {
            let order = u8::try_from(index + 1).expect("four fixture positions fit u8");
            let incidents = incident_values(|_name| ocr_field(&json!(0), &json!("0"), &json!(0.9)));
            json!({
                "raw_player_name": empty_ocr_field(),
                "member_id": null,
                "play_order": ocr_field(
                    &json!(order),
                    &json!(color),
                    &json!(1.0)
                ),
                "rank": empty_ocr_field(),
                "total_assets_man_yen": empty_ocr_field(),
                "revenue_man_yen": empty_ocr_field(),
                "incidents": incidents,
            })
        })
        .collect::<Vec<_>>();
    let rows = (1_u8..=4)
        .map(|_order| {
            json!({
                "raw_player_name": null,
                "counts": incident_values(|_name| json!(0)),
                "confidence": null,
                "warnings": [],
            })
        })
        .collect::<Vec<_>>();
    (
        players,
        json!({
            "status": "parsed",
            "parser": RequestedScreenType::IncidentLog.wire(),
            "layout_profile_id": "full-hd-incident-log-v1",
            "incident_names": incident_names(),
            "rows": rows,
            "player_order": player_order,
            "include_raw_text": false,
        }),
    )
}

fn ocr_field(value: &JsonValue, raw_text: &JsonValue, confidence: &JsonValue) -> JsonValue {
    json!({
        "value": value,
        "raw_text": raw_text,
        "confidence": confidence,
        "warnings": [],
    })
}

fn empty_ocr_field() -> JsonValue {
    ocr_field(&JsonValue::Null, &JsonValue::Null, &JsonValue::Null)
}

fn player_order_fixture() -> JsonValue {
    let slots = ["blue", "red", "yellow", "green"]
        .into_iter()
        .enumerate()
        .map(|(index, color)| {
            json!({
                "play_order": index + 1,
                "expected_color": color,
                "detected_color": color,
                "raw_player_name": null,
                "color_confidence": 1.0,
                "name_confidence": null,
            })
        })
        .collect::<Vec<_>>();
    json!({"slots": slots, "confidence": 1.0, "warnings": []})
}

fn incident_names() -> [&'static str; 6] {
    [
        "目的地",
        "プラス駅",
        "マイナス駅",
        "カード駅",
        "カード売り場",
        "スリの銀次",
    ]
}

fn incident_values(mut value: impl FnMut(&str) -> JsonValue) -> JsonValue {
    incident_names()
        .into_iter()
        .map(|name| (String::from(name), value(name)))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

fn structured_warning() -> JsonValue {
    json!({
        "code": "MISSING_AMOUNT",
        "message": "OCR confidence was low.",
        "severity": "warning",
        "field_path": "players[0].total_assets_man_yen",
    })
}

pub(super) fn completion_with_missing_amount_warning() -> OcrDraftCompletion {
    let mut completion = valid_completion(RequestedScreenType::TotalAssets);
    replace_json_pointer(
        &mut completion.output.payload,
        "/players/0/total_assets_man_yen",
        empty_ocr_field(),
    );
    replace_json_pointer(
        &mut completion.output.payload,
        "/category_payload/rows/0/amount_man_yen",
        JsonValue::Null,
    );
    replace_json_pointer(
        &mut completion.output.payload,
        "/category_payload/rows/0/warnings",
        json!(["MISSING_AMOUNT"]),
    );
    completion.output.warnings = json!([structured_warning()]);
    let warnings = completion.output.warnings.clone();
    replace_json_pointer(&mut completion.output.payload, "/warnings", warnings);
    completion
}

fn replace_json_pointer(target: &mut JsonValue, pointer: &str, value: JsonValue) {
    let slot = target
        .pointer_mut(pointer)
        .unwrap_or_else(|| panic!("fixture pointer {pointer} must exist"));
    *slot = value;
}

fn assert_invalid_completion(claim: &ClaimedOcrJob, completion: &OcrDraftCompletion) {
    assert_eq!(
        validate_completion(claim, &OcrHints::default(), completion)
            .err()
            .map(|error| error.kind()),
        Some("ocr_completion_contract")
    );
}
