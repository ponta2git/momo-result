use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value as JsonValue;

use crate::{
    OcrHints, OcrOutput, RequestedScreenType, core::names_match, result::valid_timing_values,
};

const INCIDENT_NAMES: [&str; 6] = [
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
];
const EXPECTED_COLORS: [&str; 4] = ["blue", "red", "yellow", "green"];

#[derive(Deserialize, PartialEq)]
#[serde(untagged)]
enum Nullable<T> {
    Value(T),
    Null(()),
}

impl<T> Nullable<T> {
    const fn as_ref(&self) -> Option<&T> {
        match self {
            Self::Value(value) => Some(value),
            Self::Null(()) => None,
        }
    }

    const fn is_null(&self) -> bool {
        matches!(self, Self::Null(()))
    }
}

#[derive(Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct WarningCandidate {
    code: String,
    message: String,
    severity: String,
    field_path: Nullable<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OcrFieldCandidate<T> {
    value: Nullable<T>,
    raw_text: Nullable<String>,
    confidence: Nullable<f64>,
    warnings: Vec<WarningCandidate>,
}

impl<T> OcrFieldCandidate<T> {
    fn has_valid_observations(&self) -> bool {
        (self.raw_text.as_ref().is_some() || (self.value.is_null() && self.confidence.is_null()))
            && self
                .confidence
                .as_ref()
                .is_none_or(|confidence| valid_confidence(*confidence))
            && self.warnings.is_empty()
    }

    const fn is_empty(&self) -> bool {
        self.value.is_null()
            && self.raw_text.is_null()
            && self.confidence.is_null()
            && self.warnings.is_empty()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerCandidate {
    raw_player_name: OcrFieldCandidate<String>,
    member_id: Nullable<String>,
    play_order: OcrFieldCandidate<u8>,
    rank: OcrFieldCandidate<u8>,
    total_assets_man_yen: OcrFieldCandidate<i64>,
    revenue_man_yen: OcrFieldCandidate<i64>,
    incidents: BTreeMap<String, OcrFieldCandidate<u32>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DraftPayloadCandidate {
    requested_screen_type: String,
    detected_screen_type: Nullable<String>,
    profile_id: Nullable<String>,
    players: Vec<PlayerCandidate>,
    category_payload: JsonValue,
    warnings: Vec<WarningCandidate>,
    raw_snippets: Nullable<BTreeMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerOrderCandidate {
    slots: Vec<PlayerOrderSlotCandidate>,
    confidence: f64,
    warnings: Vec<WarningCandidate>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerOrderSlotCandidate {
    play_order: u8,
    expected_color: String,
    detected_color: Nullable<String>,
    raw_player_name: Nullable<String>,
    color_confidence: f64,
    name_confidence: Nullable<f64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RankedCategoryCandidate {
    status: String,
    parser: String,
    rows: Vec<RankedRowCandidate>,
    player_order: PlayerOrderCandidate,
    include_raw_text: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RankedRowCandidate {
    rank: u8,
    raw_player_name: Nullable<String>,
    amount_man_yen: Nullable<i64>,
    confidence: Nullable<f64>,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IncidentCategoryCandidate {
    status: String,
    parser: String,
    layout_profile_id: String,
    incident_names: Vec<String>,
    rows: Vec<IncidentRowCandidate>,
    player_order: PlayerOrderCandidate,
    include_raw_text: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IncidentRowCandidate {
    raw_player_name: Nullable<String>,
    counts: BTreeMap<String, Nullable<u32>>,
    confidence: Nullable<f64>,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimingCandidate {
    decode: f64,
    engine_initialization: f64,
    detect_player_order: f64,
    parse: f64,
    total: f64,
}

pub(super) fn valid_output(
    output: &OcrOutput,
    expected_screen: RequestedScreenType,
    hints: &OcrHints,
    parent_elapsed_milliseconds: u32,
) -> bool {
    let expected_profile = expected_screen.expected_profile_id();
    if output.detected_screen_type != expected_screen
        || output.profile_id.as_deref() != Some(expected_profile)
    {
        return false;
    }
    let Ok(payload) = serde_json::from_value::<DraftPayloadCandidate>(output.payload.clone())
    else {
        return false;
    };
    let Ok(warnings) = serde_json::from_value::<Vec<WarningCandidate>>(output.warnings.clone())
    else {
        return false;
    };
    let Ok(timings) =
        serde_json::from_value::<TimingCandidate>(output.timings_milliseconds.clone())
    else {
        return false;
    };
    output.payload.get("warnings") == Some(&output.warnings)
        && valid_payload(&payload, expected_screen, expected_profile, hints)
        && valid_warnings(&warnings)
        && valid_timings(&timings, parent_elapsed_milliseconds)
}

fn valid_payload(
    payload: &DraftPayloadCandidate,
    expected_screen: RequestedScreenType,
    expected_profile: &str,
    hints: &OcrHints,
) -> bool {
    let screen = expected_screen.wire();
    payload.requested_screen_type == screen
        && payload.detected_screen_type.as_ref().map(String::as_str) == Some(screen)
        && payload.profile_id.as_ref().map(String::as_str) == Some(expected_profile)
        && payload.raw_snippets.is_null()
        && payload.players.len() == 4
        && valid_warnings(&payload.warnings)
        && match expected_screen {
            RequestedScreenType::TotalAssets | RequestedScreenType::Revenue => {
                serde_json::from_value::<RankedCategoryCandidate>(payload.category_payload.clone())
                    .is_ok_and(|category| {
                        valid_ranked_category(
                            &category,
                            &payload.players,
                            expected_screen,
                            hints,
                            &payload.warnings,
                        )
                    })
            }
            RequestedScreenType::IncidentLog => {
                serde_json::from_value::<IncidentCategoryCandidate>(
                    payload.category_payload.clone(),
                )
                .is_ok_and(|category| {
                    valid_incident_category(&category, &payload.players, hints, &payload.warnings)
                })
            }
        }
}

fn valid_incident_fields(fields: &BTreeMap<String, OcrFieldCandidate<u32>>) -> bool {
    exact_keys(fields.keys().map(String::as_str), &INCIDENT_NAMES)
        && fields
            .values()
            .all(OcrFieldCandidate::has_valid_observations)
}

fn valid_ranked_category(
    category: &RankedCategoryCandidate,
    players: &[PlayerCandidate],
    screen: RequestedScreenType,
    hints: &OcrHints,
    warnings: &[WarningCandidate],
) -> bool {
    category.status == "parsed"
        && category.parser == screen.wire()
        && !category.include_raw_text
        && valid_player_order(&category.player_order)
        && valid_ranked_players(players, category, screen, hints)
        && valid_ranked_warnings(players, category, screen, warnings)
        && category.rows.len() == 4
        && category.rows.iter().enumerate().all(|(index, row)| {
            let Some(player) = players.get(index) else {
                return false;
            };
            let player_amount = match screen {
                RequestedScreenType::TotalAssets => &player.total_assets_man_yen.value,
                RequestedScreenType::Revenue => &player.revenue_man_yen.value,
                RequestedScreenType::IncidentLog => return false,
            };
            u8::try_from(index)
                .ok()
                .and_then(|value| value.checked_add(1))
                == Some(row.rank)
                && row.raw_player_name == player.raw_player_name.value
                && row.amount_man_yen.as_ref() == player_amount.as_ref()
                && row
                    .raw_player_name
                    .as_ref()
                    .is_none_or(|name| !name.is_empty())
                && row
                    .confidence
                    .as_ref()
                    .is_none_or(|confidence| valid_confidence(*confidence))
                && row.warnings == expected_ranked_row_warning_codes(player, player_amount)
        })
}

fn valid_ranked_players(
    players: &[PlayerCandidate],
    category: &RankedCategoryCandidate,
    screen: RequestedScreenType,
    hints: &OcrHints,
) -> bool {
    players.iter().enumerate().all(|(index, player)| {
        let Some(rank) = one_based(index) else {
            return false;
        };
        let Some(row) = category.rows.get(index) else {
            return false;
        };
        let selected_amount = match screen {
            RequestedScreenType::TotalAssets => &player.total_assets_man_yen,
            RequestedScreenType::Revenue => &player.revenue_man_yen,
            RequestedScreenType::IncidentLog => return false,
        };
        player.raw_player_name.has_valid_observations()
            && player
                .raw_player_name
                .value
                .as_ref()
                .is_none_or(|name| !name.is_empty())
            && player.raw_player_name.value.is_null() == player.raw_player_name.raw_text.is_null()
            && player
                .raw_player_name
                .value
                .as_ref()
                .is_none_or(|_| player.raw_player_name.confidence == row.confidence)
            && valid_member_id(&player.member_id, &player.raw_player_name, hints)
            && valid_rank_field(&player.rank, rank)
            && valid_ranked_play_order(
                &player.play_order,
                &player.raw_player_name,
                &category.player_order,
            )
            && valid_ranked_amount(selected_amount, row)
            && match screen {
                RequestedScreenType::TotalAssets => player.revenue_man_yen.is_empty(),
                RequestedScreenType::Revenue => player.total_assets_man_yen.is_empty(),
                RequestedScreenType::IncidentLog => false,
            }
            && player.incidents.is_empty()
    })
}

fn valid_member_id(
    member_id: &Nullable<String>,
    player_name: &OcrFieldCandidate<String>,
    hints: &OcrHints,
) -> bool {
    member_id.as_ref().is_none_or(|member_id| {
        player_name.value.as_ref().is_some_and(|player_name| {
            hints.known_player_aliases().iter().any(|hint| {
                hint.member_id() == member_id
                    && hint
                        .aliases()
                        .iter()
                        .any(|alias| names_match(player_name, alias))
            })
        })
    })
}

fn valid_rank_field(field: &OcrFieldCandidate<u8>, rank: u8) -> bool {
    field.value.as_ref() == Some(&rank)
        && field.raw_text.as_ref().map(String::as_str) == Some(rank.to_string().as_str())
        && field.confidence.as_ref() == Some(&1.0)
        && field.warnings.is_empty()
}

fn valid_ranked_play_order(
    field: &OcrFieldCandidate<u8>,
    player_name: &OcrFieldCandidate<String>,
    order: &PlayerOrderCandidate,
) -> bool {
    let Some(player_name) = player_name.value.as_ref() else {
        return field.is_empty();
    };
    let matched = order.slots.iter().find(|slot| {
        slot.raw_player_name
            .as_ref()
            .is_some_and(|slot_name| names_match(player_name, slot_name))
    });
    let Some(slot) = matched else {
        return field.is_empty();
    };
    field.value.as_ref() == Some(&slot.play_order)
        && field.raw_text.as_ref() == slot.raw_player_name.as_ref()
        && field.confidence.as_ref() == Some(&slot.color_confidence)
        && field.warnings.is_empty()
}

fn valid_ranked_amount(field: &OcrFieldCandidate<i64>, row: &RankedRowCandidate) -> bool {
    field.value.as_ref().map_or_else(
        || field.is_empty() && row.amount_man_yen.is_null(),
        |value| {
            row.amount_man_yen.as_ref() == Some(value)
                && field.raw_text.as_ref().is_some_and(|raw| !raw.is_empty())
                && field.confidence == row.confidence
                && field.warnings.is_empty()
        },
    )
}

fn valid_incident_category(
    category: &IncidentCategoryCandidate,
    players: &[PlayerCandidate],
    hints: &OcrHints,
    warnings: &[WarningCandidate],
) -> bool {
    category.status == "parsed"
        && category.parser == RequestedScreenType::IncidentLog.wire()
        && matches!(
            category.layout_profile_id.as_str(),
            "full-hd-incident-log-v1" | "full-hd-incident-log-compact-v1"
        )
        && !category.include_raw_text
        && category
            .incident_names
            .iter()
            .map(String::as_str)
            .eq(INCIDENT_NAMES)
        && valid_incident_layout(category, hints)
        && valid_player_order(&category.player_order)
        && valid_incident_players(players, &category.player_order)
        && valid_incident_warnings(players, category, warnings)
        && category.rows.len() == 4
        && category.rows.iter().enumerate().all(|(index, row)| {
            let Some(player) = players.get(index) else {
                return false;
            };
            row.raw_player_name.is_null()
                && row.confidence.is_null()
                && exact_keys(row.counts.keys().map(String::as_str), &INCIDENT_NAMES)
                && INCIDENT_NAMES.iter().all(|name| {
                    row.counts.get(*name).and_then(Nullable::as_ref)
                        == player
                            .incidents
                            .get(*name)
                            .and_then(|field| field.value.as_ref())
                })
                && row.warnings == expected_incident_row_warning_codes(warnings, index)
        })
}

fn valid_incident_layout(category: &IncidentCategoryCandidate, hints: &OcrHints) -> bool {
    let normalized = hints
        .layout_family()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    match normalized.as_str() {
        "world" | "momotetsu_world" | "default" => {
            category.layout_profile_id == "full-hd-incident-log-v1"
        }
        "reiwa" | "momotetsu_reiwa" | "momotetsu_2" | "momotetsu2" | "2" => {
            category.layout_profile_id == "full-hd-incident-log-compact-v1"
        }
        _ => matches!(
            category.layout_profile_id.as_str(),
            "full-hd-incident-log-v1" | "full-hd-incident-log-compact-v1"
        ),
    }
}

fn valid_incident_players(players: &[PlayerCandidate], order: &PlayerOrderCandidate) -> bool {
    players.iter().enumerate().all(|(index, player)| {
        let Some(slot) = order.slots.get(index) else {
            return false;
        };
        let valid_name = slot.raw_player_name.as_ref().map_or_else(
            || player.raw_player_name.is_empty(),
            |name| {
                player.raw_player_name.value.as_ref() == Some(name)
                    && player.raw_player_name.raw_text.as_ref() == Some(name)
                    && player.raw_player_name.confidence == slot.name_confidence
                    && player.raw_player_name.warnings.is_empty()
            },
        );
        valid_name
            && player.member_id.is_null()
            && player.play_order.value.as_ref() == Some(&slot.play_order)
            && player.play_order.raw_text.as_ref().map(String::as_str)
                == Some(slot.expected_color.as_str())
            && player.play_order.confidence.as_ref() == Some(&slot.color_confidence)
            && player.play_order.warnings.is_empty()
            && player.rank.is_empty()
            && player.total_assets_man_yen.is_empty()
            && player.revenue_man_yen.is_empty()
            && valid_incident_fields(&player.incidents)
    })
}

fn valid_player_order(order: &PlayerOrderCandidate) -> bool {
    valid_confidence(order.confidence)
        && valid_warnings(&order.warnings)
        && order.slots.len() == 4
        && order.slots.iter().zip(EXPECTED_COLORS).enumerate().all(
            |(index, (slot, expected_color))| {
                u8::try_from(index)
                    .ok()
                    .and_then(|value| value.checked_add(1))
                    == Some(slot.play_order)
                    && slot.expected_color == expected_color
                    && slot
                        .detected_color
                        .as_ref()
                        .is_none_or(|color| EXPECTED_COLORS.contains(&color.as_str()))
                    && slot
                        .raw_player_name
                        .as_ref()
                        .is_none_or(|name| !name.is_empty())
                    && valid_confidence(slot.color_confidence)
                    && slot
                        .name_confidence
                        .as_ref()
                        .is_none_or(|confidence| valid_confidence(*confidence))
                    && (slot.raw_player_name.as_ref().is_some() || slot.name_confidence.is_null())
            },
        )
        && order.confidence.total_cmp(
            &order
                .slots
                .iter()
                .map(|slot| slot.color_confidence)
                .min_by(f64::total_cmp)
                .unwrap_or(0.0),
        ) == std::cmp::Ordering::Equal
        && warnings_match(
            &order.warnings,
            &expected_player_order_warnings(&order.slots),
        )
}

fn valid_warnings(warnings: &[WarningCandidate]) -> bool {
    warnings.iter().all(|warning| {
        valid_warning_code(&warning.code)
            && !warning.message.is_empty()
            && warning.severity == "warning"
            && warning
                .field_path
                .as_ref()
                .is_none_or(|field_path| !field_path.is_empty())
    })
}

fn valid_ranked_warnings(
    players: &[PlayerCandidate],
    category: &RankedCategoryCandidate,
    screen: RequestedScreenType,
    warnings: &[WarningCandidate],
) -> bool {
    let mut expected = expected_player_order_warnings(&category.player_order.slots);
    for (index, player) in players.iter().enumerate() {
        let Some(amount) = (match screen {
            RequestedScreenType::TotalAssets => Some(&player.total_assets_man_yen.value),
            RequestedScreenType::Revenue => Some(&player.revenue_man_yen.value),
            RequestedScreenType::IncidentLog => None,
        }) else {
            return false;
        };
        if player.raw_player_name.value.is_null() {
            expected.push((
                "UNKNOWN_PLAYER_ALIAS",
                format!("players[{index}].raw_player_name"),
            ));
        }
        if amount.is_null() {
            let field = match screen {
                RequestedScreenType::TotalAssets => "total_assets_man_yen",
                RequestedScreenType::Revenue => "revenue_man_yen",
                RequestedScreenType::IncidentLog => return false,
            };
            expected.push(("MISSING_AMOUNT", format!("players[{index}].{field}")));
        }
    }
    if screen == RequestedScreenType::Revenue {
        let mut first_index_by_member = BTreeMap::new();
        for (index, player) in players.iter().enumerate() {
            let Some(member_id) = player.member_id.as_ref() else {
                continue;
            };
            if first_index_by_member.contains_key(member_id) {
                expected.push((
                    "DUPLICATE_MEMBER_ALIAS",
                    format!("players[{index}].member_id"),
                ));
            } else {
                first_index_by_member.insert(member_id, index);
            }
        }
    }
    warnings_match(warnings, &expected)
}

fn valid_incident_warnings(
    players: &[PlayerCandidate],
    category: &IncidentCategoryCandidate,
    warnings: &[WarningCandidate],
) -> bool {
    let mut expected = expected_player_order_warnings(&category.player_order.slots);
    let mut ginji_total = 0_u32;
    for (player_index, player) in players.iter().enumerate() {
        let mut station_total = 0_u32;
        for incident_name in INCIDENT_NAMES {
            let Some(field) = player.incidents.get(incident_name) else {
                return false;
            };
            match field.value.as_ref() {
                Some(value) if incident_name == "スリの銀次" => {
                    if *value > 2 {
                        return false;
                    }
                    ginji_total = ginji_total.saturating_add(*value);
                }
                Some(value) => {
                    if *value > 12 {
                        return false;
                    }
                    station_total = station_total.saturating_add(*value);
                }
                None => expected.push((
                    "MISSING_INCIDENT_COUNT",
                    format!("players[{player_index}].incidents[{incident_name:?}]"),
                )),
            }
        }
        if station_total > 14 {
            expected.push((
                "SUSPICIOUS_INCIDENT_COUNT",
                format!("players[{player_index}].incidents"),
            ));
        }
    }
    if ginji_total > 2 {
        expected.push((
            "SUSPICIOUS_INCIDENT_COUNT",
            String::from("players[].incidents['スリの銀次']"),
        ));
    }
    warning_multiset_matches(warnings, &expected)
}

fn expected_player_order_warnings(
    slots: &[PlayerOrderSlotCandidate],
) -> Vec<(&'static str, String)> {
    slots
        .iter()
        .enumerate()
        .filter(|(index, slot)| {
            slot.detected_color.as_ref().map(String::as_str) != EXPECTED_COLORS.get(*index).copied()
                || slot.color_confidence < 0.45
        })
        .map(|(index, _slot)| {
            (
                "PLAYER_ORDER_UNDETECTED",
                format!("player_order[{index}].detected_color"),
            )
        })
        .collect()
}

fn expected_ranked_row_warning_codes(
    player: &PlayerCandidate,
    amount: &Nullable<i64>,
) -> Vec<String> {
    let mut expected = Vec::with_capacity(2);
    if player.raw_player_name.value.is_null() {
        expected.push(String::from("UNKNOWN_PLAYER_ALIAS"));
    }
    if amount.is_null() {
        expected.push(String::from("MISSING_AMOUNT"));
    }
    expected
}

fn expected_incident_row_warning_codes(
    warnings: &[WarningCandidate],
    player_index: usize,
) -> Vec<String> {
    let prefix = format!("players[{player_index}].");
    warnings
        .iter()
        .filter(|warning| {
            warning
                .field_path
                .as_ref()
                .is_some_and(|path| path.starts_with(&prefix))
        })
        .map(|warning| warning.code.clone())
        .collect()
}

fn warnings_match(actual: &[WarningCandidate], expected: &[(&str, String)]) -> bool {
    actual.len() == expected.len()
        && actual.iter().zip(expected).all(|(warning, (code, path))| {
            warning.code == *code
                && warning.field_path.as_ref().map(String::as_str) == Some(path.as_str())
        })
}

fn warning_multiset_matches(actual: &[WarningCandidate], expected: &[(&str, String)]) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    let mut actual = actual
        .iter()
        .map(|warning| {
            (
                warning.code.as_str(),
                warning.field_path.as_ref().map(String::as_str),
            )
        })
        .collect::<Vec<_>>();
    let mut expected = expected
        .iter()
        .map(|(code, path)| (*code, Some(path.as_str())))
        .collect::<Vec<_>>();
    actual.sort_unstable();
    expected.sort_unstable();
    actual == expected
}

fn valid_warning_code(code: &str) -> bool {
    matches!(
        code,
        "PLAYER_ORDER_UNDETECTED"
            | "UNKNOWN_PLAYER_ALIAS"
            | "MISSING_AMOUNT"
            | "DUPLICATE_MEMBER_ALIAS"
            | "MISSING_INCIDENT_COUNT"
            | "SUSPICIOUS_INCIDENT_COUNT"
    )
}

fn valid_timings(timings: &TimingCandidate, parent_elapsed_milliseconds: u32) -> bool {
    let phases = [
        timings.decode,
        timings.engine_initialization,
        timings.detect_player_order,
        timings.parse,
    ];
    valid_timing_values(phases, timings.total)
        && timings.total <= f64::from(parent_elapsed_milliseconds) + 1.0
}

fn valid_confidence(confidence: f64) -> bool {
    confidence.is_finite() && (0.0..=1.0).contains(&confidence)
}

fn one_based(index: usize) -> Option<u8> {
    u8::try_from(index)
        .ok()
        .and_then(|value| value.checked_add(1))
}

fn exact_keys<'a>(actual: impl Iterator<Item = &'a str>, expected: &[&str]) -> bool {
    let actual = actual.collect::<Vec<_>>();
    actual.len() == expected.len() && expected.iter().all(|key| actual.contains(key))
}
