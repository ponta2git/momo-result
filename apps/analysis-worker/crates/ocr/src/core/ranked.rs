use std::collections::{BTreeMap, BTreeSet};

use image::{DynamicImage, GrayImage};
use serde_json::json;

use super::{
    AliasResolver, OcrField, OcrWarning, PlayerDraft, PlayerIdentity, RecognitionSession, Rect,
    crop, has_unit_bearing_money_text, names_match, parse_money_man_yen, parse_revenue_man_yen,
    pipeline::{CoreOcrError, ParsedScreen},
    player_order::PlayerOrderDetection,
    preprocess::prepare_ranked_row_variants,
    recognition::RecognitionLanguage,
    scale_profile_rect,
};
use crate::contract::RequestedScreenType;

const ROWS: [(u8, u32); 4] = [(1, 200), (2, 395), (3, 585), (4, 775)];

struct RankedRecognition {
    text: String,
    confidence: Option<f64>,
}

pub(super) fn parse(
    image: &DynamicImage,
    screen_type: RequestedScreenType,
    aliases: &AliasResolver,
    player_order: &PlayerOrderDetection,
    recognition: &mut RecognitionSession,
) -> Result<ParsedScreen, CoreOcrError> {
    let mut players = Vec::with_capacity(ROWS.len());
    let mut warnings = Vec::new();
    let mut payload_rows = Vec::with_capacity(ROWS.len());
    for (rank, y) in ROWS {
        let rect = scale_profile_rect(
            Rect {
                x: 0,
                y,
                width: 1920,
                height: 195,
            },
            image.width(),
            image.height(),
        )?;
        let row_image = crop(image, rect)?;
        let recognized = recognize_row(&row_image, recognition)?;
        let identity = aliases.extract(&recognized.text);
        let amount = match screen_type {
            RequestedScreenType::TotalAssets => parse_money_man_yen(&recognized.text),
            RequestedScreenType::Revenue => parse_revenue_man_yen(&recognized.text),
            RequestedScreenType::IncidentLog => return Err(CoreOcrError::Parser),
        };
        let row_warnings = row_warnings(rank, &identity, amount, screen_type);
        warnings.extend(row_warnings.iter().cloned());
        let player = ranked_player(
            rank,
            identity,
            amount,
            recognized.confidence,
            &recognized.text,
            screen_type,
            player_order,
        );
        let warning_codes: Vec<&str> = row_warnings.iter().map(OcrWarning::code).collect();
        payload_rows.push(json!({
            "rank": rank,
            "raw_player_name": player.raw_player_name.value,
            "amount_man_yen": amount,
            "confidence": recognized.confidence,
            "warnings": warning_codes,
        }));
        players.push(player);
    }
    if matches!(screen_type, RequestedScreenType::Revenue) {
        warnings.extend(duplicate_member_warnings(&players));
    }
    let parser = screen_type.wire();
    let player_order_json =
        serde_json::to_value(player_order).map_err(|_error| CoreOcrError::Parser)?;
    Ok(ParsedScreen {
        players,
        category_payload: json!({
            "status": "parsed",
            "parser": parser,
            "rows": payload_rows,
            "player_order": player_order_json,
            "include_raw_text": false,
        }),
        warnings,
    })
}

fn recognize_row(
    image: &DynamicImage,
    recognition: &mut RecognitionSession,
) -> Result<RankedRecognition, CoreOcrError> {
    let variants = prepare_ranked_row_variants(image);
    let mut snippets = Vec::new();
    let mut confidences = Vec::new();
    if let Some(primary) = variants.first() {
        run_variant(
            primary,
            &[6, 7],
            recognition,
            &mut snippets,
            &mut confidences,
        )?;
    }
    for variant in variants.iter().skip(1) {
        if has_money_and_name(&snippets) {
            break;
        }
        run_variant(
            variant,
            &[6, 7],
            recognition,
            &mut snippets,
            &mut confidences,
        )?;
    }
    if !has_money_and_name(&snippets) {
        run_color_variant(image, &[6, 7], recognition, &mut snippets, &mut confidences)?;
    }
    if !has_money_and_name(&snippets) {
        for variant in &variants {
            if has_money_and_name(&snippets) {
                break;
            }
            run_variant(variant, &[11], recognition, &mut snippets, &mut confidences)?;
        }
    }
    Ok(RankedRecognition {
        text: snippets.join(" | "),
        confidence: confidences.into_iter().max_by(f64::total_cmp),
    })
}

fn run_color_variant(
    image: &DynamicImage,
    psms: &[u8],
    recognition: &mut RecognitionSession,
    snippets: &mut Vec<String>,
    confidences: &mut Vec<f64>,
) -> Result<(), CoreOcrError> {
    for psm in psms {
        let recognized = recognition.recognize_color(image, RecognitionLanguage::General, *psm)?;
        append_recognition(recognized, snippets, confidences);
        if has_money_and_name(snippets) {
            break;
        }
    }
    Ok(())
}

fn run_variant(
    image: &GrayImage,
    psms: &[u8],
    recognition: &mut RecognitionSession,
    snippets: &mut Vec<String>,
    confidences: &mut Vec<f64>,
) -> Result<(), CoreOcrError> {
    for psm in psms {
        let recognized = recognition.recognize(image, RecognitionLanguage::General, *psm)?;
        append_recognition(recognized, snippets, confidences);
        if has_money_and_name(snippets) {
            break;
        }
    }
    Ok(())
}

fn append_recognition(
    recognized: super::RecognizedText,
    snippets: &mut Vec<String>,
    confidences: &mut Vec<f64>,
) {
    if !recognized.text.is_empty() && !snippets.contains(&recognized.text) {
        snippets.push(recognized.text);
    }
    if let Some(confidence) = recognized.confidence {
        confidences.push(confidence);
    }
}

fn has_money_and_name(snippets: &[String]) -> bool {
    if snippets.is_empty() {
        return false;
    }
    let combined = snippets.join(" | ");
    has_unit_bearing_money_text(&combined) && combined.contains("社長")
}

fn ranked_player(
    rank: u8,
    identity: PlayerIdentity,
    amount: Option<i64>,
    confidence: Option<f64>,
    raw_text: &str,
    screen_type: RequestedScreenType,
    player_order: &PlayerOrderDetection,
) -> PlayerDraft {
    let mut player = PlayerDraft::empty();
    player.rank = OcrField::recognized(rank, rank.to_string(), Some(1.0));
    if let Some(name) = identity.display_name {
        player.play_order = matched_play_order(&name, player_order);
        player.raw_player_name = OcrField::recognized(name, raw_text, confidence);
    }
    player.member_id = identity.member_id;
    if let Some(amount) = amount {
        let field = OcrField::recognized(amount, raw_text, confidence);
        match screen_type {
            RequestedScreenType::TotalAssets => player.total_assets_man_yen = field,
            RequestedScreenType::Revenue => player.revenue_man_yen = field,
            RequestedScreenType::IncidentLog => {}
        }
    }
    player
}

fn matched_play_order(name: &str, detection: &PlayerOrderDetection) -> OcrField<u8> {
    detection
        .slots
        .iter()
        .find(|slot| {
            slot.raw_player_name
                .as_deref()
                .is_some_and(|slot_name| names_match(name, slot_name))
        })
        .map_or_else(OcrField::empty, |slot| {
            OcrField::recognized(
                slot.play_order,
                slot.raw_player_name.clone().unwrap_or_default(),
                Some(slot.color_confidence),
            )
        })
}

fn row_warnings(
    rank: u8,
    identity: &PlayerIdentity,
    amount: Option<i64>,
    screen_type: RequestedScreenType,
) -> Vec<OcrWarning> {
    let mut warnings = Vec::new();
    let player_index = rank.saturating_sub(1);
    if identity.display_name.is_none() {
        warnings.push(OcrWarning::warning(
            "UNKNOWN_PLAYER_ALIAS",
            format!("Could not read player name for rank {rank}."),
            Some(format!("players[{player_index}].raw_player_name")),
        ));
    }
    if amount.is_none() {
        let (field_name, message) = match screen_type {
            RequestedScreenType::TotalAssets => (
                "total_assets_man_yen",
                format!("Could not read total assets for rank {rank}."),
            ),
            RequestedScreenType::Revenue => (
                "revenue_man_yen",
                format!("Could not read revenue for rank {rank}."),
            ),
            RequestedScreenType::IncidentLog => return warnings,
        };
        warnings.push(OcrWarning::warning(
            "MISSING_AMOUNT",
            message,
            Some(format!("players[{player_index}].{field_name}")),
        ));
    }
    warnings
}

fn duplicate_member_warnings(players: &[PlayerDraft]) -> Vec<OcrWarning> {
    let mut first_index_by_member = BTreeMap::new();
    let mut warned = BTreeSet::new();
    let mut warnings = Vec::new();
    for (index, player) in players.iter().enumerate() {
        let Some(member_id) = player.member_id.as_deref() else {
            continue;
        };
        if let Some(previous_index) = first_index_by_member.get(member_id).copied() {
            if warned.insert(index) {
                warnings.push(OcrWarning::warning(
                    "DUPLICATE_MEMBER_ALIAS",
                    format!(
                        "Multiple revenue OCR rows resolved to the same member; first row index {previous_index} will be used for review."
                    ),
                    Some(format!("players[{index}].member_id")),
                ));
            }
        } else {
            first_index_by_member.insert(String::from(member_id), index);
        }
    }
    warnings
}
