use serde_json::Value as JsonValue;
use thiserror::Error;

use crate::contract::{OcrHints, RequestedScreenType};

/// Deterministic logical OCR result before runtime-owned observations are attached.
#[derive(Debug, Eq, PartialEq)]
pub struct OcrAnalysis {
    pub(crate) detected_screen_type: RequestedScreenType,
    pub(crate) profile_id: String,
    pub(crate) payload: JsonValue,
    pub(crate) warnings: JsonValue,
}

impl OcrAnalysis {
    /// Attaches runtime observations without allowing them to affect OCR interpretation.
    #[must_use]
    pub fn with_timings(self, timings: OcrTimings) -> OcrOutput {
        OcrOutput {
            detected_screen_type: self.detected_screen_type,
            profile_id: Some(self.profile_id),
            payload: self.payload,
            warnings: self.warnings,
            timings_milliseconds: timings.into_json(),
        }
    }
}

/// Complete runtime observations for one successful OCR attempt.
///
/// The runtime owns the clock, while this capability owns the names, units, and validity of the
/// values added to its output contract.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OcrTimings {
    decode: f64,
    engine_initialization: f64,
    detect_player_order: f64,
    parse: f64,
    total: f64,
}

impl OcrTimings {
    /// Builds a complete set of non-negative, finite millisecond observations.
    ///
    /// # Errors
    ///
    /// Returns [`InvalidOcrTimings`] if any observation cannot be represented by the JSON wire
    /// contract or is negative.
    pub fn new(
        decode_milliseconds: f64,
        engine_initialization_milliseconds: f64,
        detect_player_order_milliseconds: f64,
        parse_milliseconds: f64,
        total_milliseconds: f64,
    ) -> Result<Self, InvalidOcrTimings> {
        let phases = [
            decode_milliseconds,
            engine_initialization_milliseconds,
            detect_player_order_milliseconds,
            parse_milliseconds,
        ];
        if !valid_timing_values(phases, total_milliseconds) {
            return Err(InvalidOcrTimings);
        }
        Ok(Self {
            decode: decode_milliseconds,
            engine_initialization: engine_initialization_milliseconds,
            detect_player_order: detect_player_order_milliseconds,
            parse: parse_milliseconds,
            total: total_milliseconds,
        })
    }

    fn into_json(self) -> JsonValue {
        serde_json::json!({
            "decode": self.decode,
            "engine_initialization": self.engine_initialization,
            "detect_player_order": self.detect_player_order,
            "parse": self.parse,
            "total": self.total,
        })
    }
}

pub(crate) fn valid_timing_values(phases: [f64; 4], total: f64) -> bool {
    if phases
        .into_iter()
        .chain([total])
        .any(|value| !value.is_finite() || value < 0.0)
    {
        return false;
    }
    let phase_sum = phases.into_iter().sum::<f64>();
    let rounding_tolerance = f64::EPSILON * total.max(phase_sum).max(1.0) * 8.0;
    phase_sum.is_finite() && phase_sum <= total + rounding_tolerance
}

/// A runtime observation was negative or not finite.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("OCR timings must be finite, non-negative, and contained by total elapsed time")]
pub struct InvalidOcrTimings;

/// Logical OCR output returned by the isolated capability.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OcrOutput {
    pub detected_screen_type: RequestedScreenType,
    pub profile_id: Option<String>,
    pub payload: JsonValue,
    pub warnings: JsonValue,
    pub timings_milliseconds: JsonValue,
}

impl OcrOutput {
    /// Verifies a child success candidate against the complete capability-owned output shape.
    ///
    /// The parent supplies only trusted claim identity and elapsed time; persistence and retry
    /// remain outside this crate.
    #[must_use]
    pub fn satisfies_contract(
        &self,
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
        parent_elapsed_milliseconds: u32,
    ) -> bool {
        crate::output_contract::valid_output(
            self,
            requested_screen_type,
            hints,
            parent_elapsed_milliseconds,
        )
    }
}

/// Domain-level failures produced by image decoding, native OCR, or OCR parsing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrFailure {
    InvalidImage,
    UnsupportedImageFormat,
    DecodeFailed,
    CategoryUndetected,
    LayoutUnsupported,
    EngineUnavailable,
    ParserFailed,
}

impl OcrFailure {
    #[must_use]
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::InvalidImage => "invalid_image",
            Self::UnsupportedImageFormat => "unsupported_image_format",
            Self::DecodeFailed => "decode_failed",
            Self::CategoryUndetected => "category_undetected",
            Self::LayoutUnsupported => "layout_unsupported",
            Self::EngineUnavailable => "engine_unavailable",
            Self::ParserFailed => "parser_failed",
        }
    }

    #[must_use]
    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "invalid_image" => Some(Self::InvalidImage),
            "unsupported_image_format" => Some(Self::UnsupportedImageFormat),
            "decode_failed" => Some(Self::DecodeFailed),
            "category_undetected" => Some(Self::CategoryUndetected),
            "layout_unsupported" => Some(Self::LayoutUnsupported),
            "engine_unavailable" => Some(Self::EngineUnavailable),
            "parser_failed" => Some(Self::ParserFailed),
            _ => None,
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "valid timing fixtures abort with precise context if the contract regresses"
)]
mod tests {
    use super::*;

    #[test]
    fn timings_own_the_exact_output_shape() {
        let timings = OcrTimings::new(1.0, 2.0, 3.0, 4.0, 11.0).expect("valid timings");

        assert_eq!(
            timings.into_json(),
            serde_json::json!({
                "decode": 1.0,
                "engine_initialization": 2.0,
                "detect_player_order": 3.0,
                "parse": 4.0,
                "total": 11.0,
            })
        );
    }

    #[test]
    fn timings_reject_negative_or_non_finite_values() {
        assert_eq!(
            OcrTimings::new(-1.0, 0.0, 0.0, 0.0, 0.0),
            Err(InvalidOcrTimings)
        );
        assert_eq!(
            OcrTimings::new(0.0, 0.0, f64::NAN, 0.0, 0.0),
            Err(InvalidOcrTimings)
        );
        assert_eq!(
            OcrTimings::new(0.0, 0.0, 0.0, 0.0, f64::INFINITY),
            Err(InvalidOcrTimings)
        );
        assert_eq!(
            OcrTimings::new(1.0, 2.0, 3.0, 4.0, 9.0),
            Err(InvalidOcrTimings)
        );
    }
}
