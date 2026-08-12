use serde_json::Value as JsonValue;

use crate::contract::RequestedScreenType;

/// Logical OCR output returned by the isolated capability.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OcrOutput {
    pub detected_screen_type: RequestedScreenType,
    pub profile_id: Option<String>,
    pub payload: JsonValue,
    pub warnings: JsonValue,
    pub timings_milliseconds: JsonValue,
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
    pub const fn wire(self) -> &'static str {
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
    pub fn from_wire(value: &str) -> Option<Self> {
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
