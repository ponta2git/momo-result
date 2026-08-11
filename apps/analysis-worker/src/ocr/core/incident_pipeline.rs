use std::collections::BTreeMap;

use image::{DynamicImage, GrayImage};
use serde_json::json;

use super::{
    CountRecognition, OcrField, OcrWarning, PlayerDraft, PsmAttempt, RecognitionSession, Rect,
    crop,
    incident::{is_pure_pipe_noise, parse_count, select_count_recognition, vote_count},
    pipeline::{CoreOcrError, ParsedScreen},
    player_order::PlayerOrderDetection,
    preprocess::{prepare_count_cell, prepare_digit_count_cells, prepare_fallback_count_cells},
    recognition::RecognitionLanguage,
    scale_profile_rect,
};

const INCIDENT_NAMES: [&str; 6] = [
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
];
const CELL_XS: [u32; 4] = [878, 1148, 1418, 1680];
const DEFAULT_YS: [u32; 6] = [330, 420, 510, 600, 690, 780];
const COMPACT_YS: [u32; 6] = [360, 450, 540, 630, 720, 810];

#[derive(Clone, Copy)]
struct IncidentProfile {
    id: &'static str,
    ys: [u32; 6],
    width: u32,
}

const DEFAULT_PROFILE: IncidentProfile = IncidentProfile {
    id: "full-hd-incident-log-v1",
    ys: DEFAULT_YS,
    width: 98,
};
const COMPACT_PROFILE: IncidentProfile = IncidentProfile {
    id: "full-hd-incident-log-compact-v1",
    ys: COMPACT_YS,
    width: 88,
};

struct IncidentAttempt {
    profile: IncidentProfile,
    player_counts: Vec<BTreeMap<String, OcrField<u32>>>,
    warnings: Vec<OcrWarning>,
    missing_count: usize,
}

pub(super) fn parse(
    image: &DynamicImage,
    layout_family_hint: Option<&str>,
    player_order: &PlayerOrderDetection,
    recognition: &mut RecognitionSession,
) -> Result<ParsedScreen, CoreOcrError> {
    let profiles = selected_profiles(layout_family_hint);
    let mut attempts = Vec::with_capacity(profiles.len());
    for profile in profiles {
        attempts.push(parse_profile(image, profile, recognition)?);
    }
    let selected = attempts
        .into_iter()
        .min_by_key(|attempt| attempt.missing_count)
        .ok_or(CoreOcrError::Parser)?;
    build_result(selected, player_order)
}

fn parse_profile(
    image: &DynamicImage,
    profile: IncidentProfile,
    recognition: &mut RecognitionSession,
) -> Result<IncidentAttempt, CoreOcrError> {
    let mut player_counts: Vec<BTreeMap<String, OcrField<u32>>> =
        (0..4).map(|_| BTreeMap::new()).collect();
    let mut warnings = Vec::new();
    let mut missing_count = 0_usize;
    for (row_index, incident_name) in INCIDENT_NAMES.iter().copied().enumerate() {
        let y = profile
            .ys
            .get(row_index)
            .copied()
            .ok_or(CoreOcrError::Parser)?;
        for (player_index, x) in CELL_XS.iter().copied().enumerate() {
            let rect = scale_profile_rect(
                Rect {
                    x,
                    y,
                    width: profile.width,
                    height: 75,
                },
                image.width(),
                image.height(),
            )?;
            let cell = crop(image, rect)?;
            let recognized = recognize_cell(&cell, incident_name, recognition)?;
            if recognized.count.is_none() {
                missing_count = missing_count.saturating_add(1);
                warnings.push(OcrWarning::warning(
                    "MISSING_INCIDENT_COUNT",
                    format!(
                        "Could not read {incident_name} count for player column {}.",
                        player_index.saturating_add(1)
                    ),
                    Some(format!(
                        "players[{player_index}].incidents[{incident_name:?}]"
                    )),
                ));
            }
            let counts = player_counts
                .get_mut(player_index)
                .ok_or(CoreOcrError::Parser)?;
            counts.insert(
                String::from(incident_name),
                OcrField::observed(recognized.count, recognized.raw_text, recognized.confidence),
            );
        }
    }
    Ok(IncidentAttempt {
        profile,
        player_counts,
        warnings,
        missing_count,
    })
}

fn recognize_cell(
    image: &DynamicImage,
    incident_name: &str,
    recognition: &mut RecognitionSession,
) -> Result<CountRecognition, CoreOcrError> {
    let primary_image = prepare_count_cell(image);
    let primary = recognize_count_variant(&primary_image, recognition)?;
    let fallback_images = prepare_fallback_count_cells(image);
    let mut fallbacks = Vec::with_capacity(fallback_images.len());
    for fallback in &fallback_images {
        fallbacks.push(recognize_count_variant(fallback, recognition)?);
    }
    let maximum = if incident_name == "スリの銀次" {
        2
    } else {
        12
    };
    let selected = select_count_recognition(&primary, &fallbacks, maximum);
    if selected.count.is_some() {
        return Ok(selected);
    }
    for digit_only in prepare_digit_count_cells(image) {
        fallbacks.push(recognize_count_variant(&digit_only, recognition)?);
    }
    Ok(select_count_recognition(&primary, &fallbacks, maximum))
}

fn recognize_count_variant(
    image: &GrayImage,
    recognition: &mut RecognitionSession,
) -> Result<CountRecognition, CoreOcrError> {
    let mut attempts = Vec::with_capacity(2);
    let mut snippets = Vec::new();
    for psm in [10_u8, 13] {
        let recognized = recognition.recognize(image, RecognitionLanguage::IncidentDigits, psm)?;
        if !recognized.text.is_empty() && !snippets.contains(&recognized.text) {
            snippets.push(recognized.text.clone());
        }
        let mut count = (!recognized.text.is_empty())
            .then(|| parse_count(&recognized.text))
            .flatten();
        if count.is_some()
            && is_pure_pipe_noise(&recognized.text)
            && recognized.confidence.unwrap_or(0.0) < 0.6
        {
            count = None;
        }
        attempts.push(PsmAttempt {
            text: recognized.text,
            count,
            confidence: recognized.confidence,
        });
    }
    let (count, confidence) = vote_count(&attempts);
    Ok(CountRecognition {
        raw_text: snippets.join(" | "),
        count,
        confidence,
    })
}

fn build_result(
    mut selected: IncidentAttempt,
    player_order: &PlayerOrderDetection,
) -> Result<ParsedScreen, CoreOcrError> {
    selected
        .warnings
        .extend(plausibility_warnings(&selected.player_counts));
    let mut players = Vec::with_capacity(selected.player_counts.len());
    let mut payload_rows = Vec::with_capacity(selected.player_counts.len());
    for (player_index, counts) in selected.player_counts.into_iter().enumerate() {
        let mut player = PlayerDraft::empty();
        player.incidents = counts;
        if let Some(slot) = player_order.slots.get(player_index) {
            player.play_order = OcrField::recognized(
                slot.play_order,
                slot.expected_color,
                Some(slot.color_confidence),
            );
            if let Some(name) = slot.raw_player_name.as_deref() {
                player.raw_player_name =
                    OcrField::recognized(String::from(name), name, slot.name_confidence);
            }
        }
        let row_warning_codes: Vec<&str> = selected
            .warnings
            .iter()
            .filter(|warning| {
                warning
                    .field_path()
                    .is_some_and(|path| path.starts_with(&format!("players[{player_index}].")))
            })
            .map(OcrWarning::code)
            .collect();
        let count_values: BTreeMap<&str, Option<u32>> = INCIDENT_NAMES
            .iter()
            .copied()
            .map(|name| {
                let value = player.incidents.get(name).and_then(|field| field.value);
                (name, value)
            })
            .collect();
        payload_rows.push(json!({
            "raw_player_name": null,
            "counts": count_values,
            "confidence": null,
            "warnings": row_warning_codes,
        }));
        players.push(player);
    }
    let player_order_json =
        serde_json::to_value(player_order).map_err(|_error| CoreOcrError::Parser)?;
    Ok(ParsedScreen {
        players,
        category_payload: json!({
            "status": "parsed",
            "parser": "incident_log",
            "layout_profile_id": selected.profile.id,
            "incident_names": INCIDENT_NAMES,
            "rows": payload_rows,
            "player_order": player_order_json,
            "include_raw_text": false,
        }),
        warnings: selected.warnings,
    })
}

fn plausibility_warnings(player_counts: &[BTreeMap<String, OcrField<u32>>]) -> Vec<OcrWarning> {
    let mut warnings = Vec::new();
    let mut ginji_total = 0_u32;
    for (player_index, counts) in player_counts.iter().enumerate() {
        let mut station_total = 0_u32;
        for (incident_name, field) in counts {
            let value = field.value.unwrap_or(0);
            if incident_name == "スリの銀次" {
                ginji_total = ginji_total.saturating_add(value);
                continue;
            }
            station_total = station_total.saturating_add(value);
            if value > 12 {
                warnings.push(OcrWarning::warning(
                    "SUSPICIOUS_INCIDENT_COUNT",
                    format!(
                        "{incident_name} count for player column {} is {value}, which is high for a 12-turn game.",
                        player_index.saturating_add(1)
                    ),
                    Some(format!(
                        "players[{player_index}].incidents[{incident_name:?}]"
                    )),
                ));
            }
        }
        if station_total > 14 {
            warnings.push(OcrWarning::warning(
                "SUSPICIOUS_INCIDENT_COUNT",
                format!(
                    "Incident station-stop total for player column {} is {station_total}, which is high for a 12-turn game.",
                    player_index.saturating_add(1)
                ),
                Some(format!("players[{player_index}].incidents")),
            ));
        }
    }
    if ginji_total > 2 {
        warnings.push(OcrWarning::warning(
            "SUSPICIOUS_INCIDENT_COUNT",
            format!("スリの銀次 total is {ginji_total}, which is high for one 12-turn game."),
            Some(String::from("players[].incidents['スリの銀次']")),
        ));
    }
    warnings
}

fn selected_profiles(layout_family_hint: Option<&str>) -> Vec<IncidentProfile> {
    let normalized = layout_family_hint.unwrap_or_default().trim().to_lowercase();
    if matches!(normalized.as_str(), "world" | "momotetsu_world" | "default") {
        vec![DEFAULT_PROFILE]
    } else if matches!(
        normalized.as_str(),
        "reiwa" | "momotetsu_reiwa" | "momotetsu_2" | "momotetsu2" | "2"
    ) {
        vec![COMPACT_PROFILE]
    } else {
        vec![DEFAULT_PROFILE, COMPACT_PROFILE]
    }
}
