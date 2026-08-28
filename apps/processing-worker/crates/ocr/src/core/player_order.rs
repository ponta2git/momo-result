use image::DynamicImage;
use serde::Serialize;

use super::{
    AliasResolver, OcrWarning, RecognitionPort, Rect, crop,
    geometry::GeometryError,
    preprocess::prepare_slot_name_variants,
    recognition::{
        PageSegmentationMode, RecognitionError, RecognitionLanguage, recognize_color,
        recognize_gray,
    },
    scale_profile_rect,
};

const SLOT_XS: [u32; 4] = [114, 548, 981, 1414];
const EXPECTED_COLORS: [&str; 4] = ["blue", "red", "yellow", "green"];
const SLOT_Y: u32 = 970;
const SLOT_WIDTH: u32 = 410;
const SLOT_HEIGHT: u32 = 90;

#[derive(Clone, Debug, Serialize)]
pub(super) struct PlayerOrderSlot {
    pub(super) play_order: u8,
    pub(super) expected_color: &'static str,
    detected_color: Option<&'static str>,
    pub(super) raw_player_name: Option<String>,
    pub(super) color_confidence: f64,
    pub(super) name_confidence: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct PlayerOrderDetection {
    pub(super) slots: Vec<PlayerOrderSlot>,
    confidence: f64,
    pub(super) warnings: Vec<OcrWarning>,
}

#[derive(Clone, Debug)]
struct NameCandidate {
    name: String,
    confidence: Option<f64>,
    score: f64,
}

pub(super) fn detect(
    image: &DynamicImage,
    aliases: &AliasResolver,
    recognition: &mut dyn RecognitionPort,
) -> Result<PlayerOrderDetection, PlayerOrderError> {
    let mut slots = Vec::with_capacity(SLOT_XS.len());
    let mut warnings = Vec::new();
    for (index, x) in SLOT_XS.iter().copied().enumerate() {
        let profile = Rect {
            x,
            y: SLOT_Y,
            width: SLOT_WIDTH,
            height: SLOT_HEIGHT,
        };
        let rect = scale_profile_rect(profile, image.width(), image.height())?;
        let slot_image = crop(image, rect)?;
        let (detected_color, color_confidence) = dominant_color(&slot_image);
        let (raw_player_name, name_confidence) =
            recognize_slot_name(&slot_image, aliases, recognition)?;
        let play_order =
            u8::try_from(index.saturating_add(1)).map_err(|_error| PlayerOrderError::Geometry)?;
        let expected_color = EXPECTED_COLORS
            .get(index)
            .copied()
            .ok_or(PlayerOrderError::Geometry)?;
        if detected_color != Some(expected_color) || color_confidence < 0.45 {
            warnings.push(OcrWarning::warning(
                "PLAYER_ORDER_UNDETECTED",
                format!(
                    "Could not confidently detect {expected_color} indicator for play order {play_order}."
                ),
                Some(format!("player_order[{index}].detected_color")),
            ));
        }
        slots.push(PlayerOrderSlot {
            play_order,
            expected_color,
            detected_color,
            raw_player_name,
            color_confidence,
            name_confidence,
        });
    }
    let confidence = slots
        .iter()
        .map(|slot| slot.color_confidence)
        .min_by(f64::total_cmp)
        .unwrap_or(0.0);
    Ok(PlayerOrderDetection {
        slots,
        confidence,
        warnings,
    })
}

fn recognize_slot_name(
    image: &DynamicImage,
    aliases: &AliasResolver,
    recognition: &mut dyn RecognitionPort,
) -> Result<(Option<String>, Option<f64>), RecognitionError> {
    let raw_candidates = recognize_raw_name(image, aliases, recognition)?;
    if let Some(candidate) = raw_candidates
        .iter()
        .filter(|candidate| candidate.name.contains("社長") && candidate.score >= 0.8)
        .max_by(|left, right| left.score.total_cmp(&right.score))
    {
        return Ok((Some(candidate.name.clone()), candidate.confidence));
    }
    let variants = prepare_slot_name_variants(image);
    let mut candidates = raw_candidates;
    for variant in &variants {
        candidates.extend(recognize_name_variant(variant, aliases, recognition)?);
    }
    Ok(candidates
        .into_iter()
        .max_by(|left, right| left.score.total_cmp(&right.score))
        .map_or((None, None), |candidate| {
            (Some(candidate.name), candidate.confidence)
        }))
}

fn recognize_raw_name(
    image: &DynamicImage,
    aliases: &AliasResolver,
    recognition: &mut dyn RecognitionPort,
) -> Result<Vec<NameCandidate>, RecognitionError> {
    let mut candidates = Vec::new();
    for segmentation in [
        PageSegmentationMode::SingleBlock,
        PageSegmentationMode::SingleWord,
    ] {
        let recognized = recognize_color(
            recognition,
            image,
            RecognitionLanguage::General,
            segmentation,
        )?;
        append_name_candidate(&mut candidates, aliases, &recognized);
    }
    Ok(candidates)
}

fn recognize_name_variant(
    image: &image::GrayImage,
    aliases: &AliasResolver,
    recognition: &mut dyn RecognitionPort,
) -> Result<Vec<NameCandidate>, RecognitionError> {
    let mut candidates = Vec::new();
    for segmentation in [
        PageSegmentationMode::SingleBlock,
        PageSegmentationMode::SingleWord,
    ] {
        let recognized = recognize_gray(
            recognition,
            image,
            RecognitionLanguage::General,
            segmentation,
        )?;
        append_name_candidate(&mut candidates, aliases, &recognized);
    }
    Ok(candidates)
}

fn append_name_candidate(
    candidates: &mut Vec<NameCandidate>,
    aliases: &AliasResolver,
    recognized: &super::RecognizedText,
) {
    let identity = aliases.extract(&recognized.text);
    if let Some(name) = identity.display_name {
        let mut score = recognized.confidence.unwrap_or(0.0);
        if name.contains("社長") {
            score += 0.1;
        }
        candidates.push(NameCandidate {
            name,
            confidence: recognized.confidence,
            score,
        });
    }
}

fn dominant_color(image: &DynamicImage) -> (Option<&'static str>, f64) {
    let mut saturated = 0_u32;
    let mut counts = [0_u32; 4];
    for pixel in image.to_rgb8().pixels() {
        let [red, green, blue] = pixel.0;
        let (hue, saturation, value) = rgb_to_hsv(red, green, blue);
        if saturation < 0.45 || value < 0.25 {
            continue;
        }
        saturated = saturated.saturating_add(1);
        if let Some(index) = hue_color_index(hue)
            && let Some(count) = counts.get_mut(index)
        {
            *count = count.saturating_add(1);
        }
    }
    if saturated == 0 {
        return (None, 0.0);
    }
    let Some((index, count)) = counts
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, count)| *count)
    else {
        return (None, 0.0);
    };
    (
        EXPECTED_COLORS.get(index).copied(),
        f64::from(count) / f64::from(saturated),
    )
}

fn rgb_to_hsv(red: u8, green: u8, blue: u8) -> (f64, f64, f64) {
    let maximum_channel = red.max(green).max(blue);
    let minimum_channel = red.min(green).min(blue);
    let red_value = f64::from(red) / 255.0;
    let green_value = f64::from(green) / 255.0;
    let blue_value = f64::from(blue) / 255.0;
    let maximum = f64::from(maximum_channel) / 255.0;
    let minimum = f64::from(minimum_channel) / 255.0;
    let delta = maximum - minimum;
    let saturation = if maximum_channel == 0 {
        0.0
    } else {
        delta / maximum
    };
    let hue = if maximum_channel == minimum_channel {
        0.0
    } else if maximum_channel == red {
        60.0 * ((green_value - blue_value) / delta).rem_euclid(6.0)
    } else if maximum_channel == green {
        60.0 * (((blue_value - red_value) / delta) + 2.0)
    } else {
        60.0 * (((red_value - green_value) / delta) + 4.0)
    };
    (hue, saturation, maximum)
}

const fn hue_color_index(hue: f64) -> Option<usize> {
    if hue <= 20.0 || hue >= 330.0 {
        Some(1)
    } else if hue >= 30.0 && hue <= 65.0 {
        Some(2)
    } else if hue >= 75.0 && hue <= 130.0 {
        Some(3)
    } else if hue >= 185.0 && hue <= 240.0 {
        Some(0)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, thiserror::Error)]
pub(super) enum PlayerOrderError {
    #[error("player order crop failed")]
    Geometry,
    #[error(transparent)]
    Recognition(#[from] RecognitionError),
}

impl From<GeometryError> for PlayerOrderError {
    fn from(_error: GeometryError) -> Self {
        Self::Geometry
    }
}

impl From<PlayerOrderError> for super::pipeline::CoreOcrError {
    fn from(error: PlayerOrderError) -> Self {
        match error {
            PlayerOrderError::Geometry => Self::Layout,
            PlayerOrderError::Recognition(recognition) => Self::from(recognition),
        }
    }
}
