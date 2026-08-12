use std::{collections::BTreeMap, path::PathBuf, time::Instant};

use image::DynamicImage;
use serde_json::Value as JsonValue;
use thiserror::Error;

use super::{
    DraftPayload, OcrWarning, RecognitionError, RecognitionSession, incident_pipeline,
    player_order, ranked,
};
use crate::contract::{OcrHints, RequestedScreenType};

const MINIMUM_WIDTH: u32 = 640;
const MINIMUM_HEIGHT: u32 = 360;
const MAXIMUM_WIDTH: u32 = 1920;
const MAXIMUM_HEIGHT: u32 = 1080;

#[derive(Debug)]
pub(crate) struct CoreOcrOutput {
    pub(crate) detected_screen_type: RequestedScreenType,
    pub(crate) profile_id: String,
    pub(crate) payload: JsonValue,
    pub(crate) warnings: JsonValue,
    pub(crate) timings_milliseconds: JsonValue,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(crate) enum CoreOcrError {
    #[error("OCR image could not be decoded")]
    Decode,
    #[error("OCR image layout is outside the supported FullHD profile")]
    Layout,
    #[error("OCR engine is unavailable")]
    EngineUnavailable,
    #[error("OCR parser failed")]
    Parser,
}

pub(crate) fn analyze(
    bytes: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
    tessdata_path: Option<PathBuf>,
) -> Result<CoreOcrOutput, CoreOcrError> {
    let total_started = Instant::now();
    let decode_started = Instant::now();
    let image = image::load_from_memory(bytes).map_err(|_error| CoreOcrError::Decode)?;
    validate_dimensions(&image)?;
    let decode_milliseconds = elapsed_milliseconds(decode_started);

    let engine_started = Instant::now();
    let mut recognition = RecognitionSession::new(tessdata_path)?;
    let engine_initialization_milliseconds = elapsed_milliseconds(engine_started);

    let order_started = Instant::now();
    let resolver = super::AliasResolver::from_hints(hints);
    let player_order =
        player_order::detect(&image, &resolver, &mut recognition).map_err(CoreOcrError::from)?;
    let player_order_milliseconds = elapsed_milliseconds(order_started);

    let parse_started = Instant::now();
    let parsed = match requested_screen_type {
        RequestedScreenType::TotalAssets | RequestedScreenType::Revenue => ranked::parse(
            &image,
            requested_screen_type,
            &resolver,
            &player_order,
            &mut recognition,
        )?,
        RequestedScreenType::IncidentLog => incident_pipeline::parse(
            &image,
            hints.layout_family(),
            &player_order,
            &mut recognition,
        )?,
    };
    let parse_milliseconds = elapsed_milliseconds(parse_started);

    let mut warnings = player_order.warnings.clone();
    warnings.extend(parsed.warnings);
    let profile_id = profile_id(requested_screen_type);
    let draft = DraftPayload {
        requested_screen_type: String::from(requested_screen_type.wire()),
        detected_screen_type: Some(String::from(requested_screen_type.wire())),
        profile_id: Some(String::from(profile_id)),
        players: parsed.players,
        category_payload: parsed.category_payload,
        warnings: warnings.clone(),
        raw_snippets: None,
    };
    let payload = serde_json::to_value(draft).map_err(|_error| CoreOcrError::Parser)?;
    let warnings = serde_json::to_value(warnings).map_err(|_error| CoreOcrError::Parser)?;
    let timings = BTreeMap::from([
        ("decode", decode_milliseconds),
        ("engine_initialization", engine_initialization_milliseconds),
        ("detect_player_order", player_order_milliseconds),
        ("parse", parse_milliseconds),
        ("total", elapsed_milliseconds(total_started)),
    ]);
    let timings_milliseconds =
        serde_json::to_value(timings).map_err(|_error| CoreOcrError::Parser)?;
    Ok(CoreOcrOutput {
        detected_screen_type: requested_screen_type,
        profile_id: String::from(profile_id),
        payload,
        warnings,
        timings_milliseconds,
    })
}

pub(super) struct ParsedScreen {
    pub(super) players: Vec<super::PlayerDraft>,
    pub(super) category_payload: JsonValue,
    pub(super) warnings: Vec<OcrWarning>,
}

impl From<RecognitionError> for CoreOcrError {
    fn from(error: RecognitionError) -> Self {
        match error {
            RecognitionError::EngineUnavailable => Self::EngineUnavailable,
            RecognitionError::RecognitionFailed | RecognitionError::Dimensions => Self::Parser,
        }
    }
}

impl From<super::geometry::GeometryError> for CoreOcrError {
    fn from(_error: super::geometry::GeometryError) -> Self {
        Self::Layout
    }
}

fn validate_dimensions(image: &DynamicImage) -> Result<(), CoreOcrError> {
    if image.width() < MINIMUM_WIDTH
        || image.height() < MINIMUM_HEIGHT
        || image.width() > MAXIMUM_WIDTH
        || image.height() > MAXIMUM_HEIGHT
    {
        return Err(CoreOcrError::Layout);
    }
    Ok(())
}

const fn profile_id(screen_type: RequestedScreenType) -> &'static str {
    match screen_type {
        RequestedScreenType::TotalAssets => "full-hd-total-assets-v1",
        RequestedScreenType::Revenue => "full-hd-revenue-v1",
        RequestedScreenType::IncidentLog => "full-hd-incident-log-v1",
    }
}

fn elapsed_milliseconds(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}
