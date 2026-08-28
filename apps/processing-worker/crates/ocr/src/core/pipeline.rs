use image::DynamicImage;
use serde_json::Value as JsonValue;
use thiserror::Error;

use super::{
    DraftPayload, OcrWarning, RecognitionError, RecognitionPort, incident_pipeline, player_order,
    ranked,
};
use crate::{
    contract::{OcrHints, RequestedScreenType},
    result::{OcrAnalysis, OcrFailure},
};

const MINIMUM_WIDTH: u32 = 640;
const MINIMUM_HEIGHT: u32 = 360;
const MAXIMUM_WIDTH: u32 = 1920;
const MAXIMUM_HEIGHT: u32 = 1080;

/// Capability phase whose elapsed time may be observed by the runtime adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrPhase {
    Decode,
    InitializeEngine,
    DetectPlayerOrder,
    Parse,
}

/// Notification emitted around a capability phase without feeding runtime state back into logic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrPhaseEvent {
    Started(OcrPhase),
    Finished(OcrPhase),
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

/// Computes one logical OCR result from bounded in-memory bytes and a native recognition port.
///
/// The observer receives phase boundaries only; it cannot alter calculation inputs or output.
/// Native engine lifecycle, clocks, filesystem paths, and persistence stay in the runtime adapter.
///
/// # Errors
///
/// Returns the closed OCR failure vocabulary for decode, layout, recognition, or parser failure.
pub fn analyze(
    bytes: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
    recognition: &mut dyn RecognitionPort,
    observe: &mut dyn FnMut(OcrPhaseEvent),
) -> Result<OcrAnalysis, OcrFailure> {
    analyze_core(bytes, requested_screen_type, hints, recognition, observe).map_err(engine_failure)
}

fn analyze_core(
    bytes: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
    recognition: &mut dyn RecognitionPort,
    observe: &mut dyn FnMut(OcrPhaseEvent),
) -> Result<OcrAnalysis, CoreOcrError> {
    let image = observe_phase(observe, OcrPhase::Decode, || {
        let image = image::load_from_memory(bytes).map_err(|_error| CoreOcrError::Decode)?;
        validate_dimensions(&image)?;
        Ok::<DynamicImage, CoreOcrError>(image)
    })?;

    observe_phase(observe, OcrPhase::InitializeEngine, || {
        recognition.initialize().map_err(CoreOcrError::from)
    })?;

    let (resolver, player_order) = observe_phase(observe, OcrPhase::DetectPlayerOrder, || {
        let resolver = super::AliasResolver::from_hints(hints);
        let player_order =
            player_order::detect(&image, &resolver, recognition).map_err(CoreOcrError::from)?;
        Ok::<_, CoreOcrError>((resolver, player_order))
    })?;

    let parsed = observe_phase(observe, OcrPhase::Parse, || match requested_screen_type {
        RequestedScreenType::TotalAssets | RequestedScreenType::Revenue => ranked::parse(
            &image,
            requested_screen_type,
            &resolver,
            &player_order,
            recognition,
        ),
        RequestedScreenType::IncidentLog => {
            incident_pipeline::parse(&image, hints.layout_family(), &player_order, recognition)
        }
    })?;

    let mut warnings = player_order.warnings.clone();
    warnings.extend(parsed.warnings);
    let profile_id = requested_screen_type.expected_profile_id();
    let warnings_json = serde_json::to_value(&warnings).map_err(|_error| CoreOcrError::Parser)?;
    let payload = serde_json::to_value(DraftPayload {
        requested_screen_type: String::from(requested_screen_type.wire()),
        detected_screen_type: Some(String::from(requested_screen_type.wire())),
        profile_id: Some(String::from(profile_id)),
        players: parsed.players,
        category_payload: parsed.category_payload,
        warnings,
        raw_snippets: None,
    })
    .map_err(|_error| CoreOcrError::Parser)?;
    Ok(OcrAnalysis {
        detected_screen_type: requested_screen_type,
        profile_id: String::from(profile_id),
        payload,
        warnings: warnings_json,
    })
}

fn observe_phase<T, E>(
    observe: &mut dyn FnMut(OcrPhaseEvent),
    phase: OcrPhase,
    operation: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    observe(OcrPhaseEvent::Started(phase));
    let result = operation();
    observe(OcrPhaseEvent::Finished(phase));
    result
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

const fn engine_failure(error: CoreOcrError) -> OcrFailure {
    match error {
        CoreOcrError::Decode => OcrFailure::DecodeFailed,
        CoreOcrError::Layout => OcrFailure::LayoutUnsupported,
        CoreOcrError::EngineUnavailable => OcrFailure::EngineUnavailable,
        CoreOcrError::Parser => OcrFailure::ParserFailed,
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "an in-memory PNG fixture must encode before it can exercise the capability boundary"
)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat, RgbImage};

    use super::*;
    use crate::{PageSegmentationMode, RecognitionFrame, RecognitionLanguage, RecognizedText};

    struct DeterministicRecognizer;

    impl RecognitionPort for DeterministicRecognizer {
        fn initialize(&mut self) -> Result<(), RecognitionError> {
            Ok(())
        }

        fn recognize(
            &mut self,
            _frame: RecognitionFrame<'_>,
            language: RecognitionLanguage,
            _segmentation: PageSegmentationMode,
        ) -> Result<RecognizedText, RecognitionError> {
            let text = match language {
                RecognitionLanguage::General => "ぽんた社長 1億0000万円",
                RecognitionLanguage::IncidentDigits => "1",
            };
            Ok(RecognizedText::new(text, Some(0.9)))
        }
    }

    #[derive(Default)]
    struct UnavailableRecognizer {
        initialize_calls: usize,
        recognize_calls: usize,
    }

    impl RecognitionPort for UnavailableRecognizer {
        fn initialize(&mut self) -> Result<(), RecognitionError> {
            self.initialize_calls = self.initialize_calls.saturating_add(1);
            Err(RecognitionError::EngineUnavailable)
        }

        fn recognize(
            &mut self,
            _frame: RecognitionFrame<'_>,
            _language: RecognitionLanguage,
            _segmentation: PageSegmentationMode,
        ) -> Result<RecognizedText, RecognitionError> {
            self.recognize_calls = self.recognize_calls.saturating_add(1);
            Err(RecognitionError::RecognitionFailed)
        }
    }

    fn png_bytes() -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(RgbImage::new(MINIMUM_WIDTH, MINIMUM_HEIGHT));
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, ImageFormat::Png)
            .expect("in-memory PNG fixture must encode");
        encoded.into_inner()
    }

    #[test]
    fn logical_output_is_deterministic_and_runtime_observation_is_one_way() {
        let bytes = png_bytes();
        let mut first_recognizer = DeterministicRecognizer;
        let mut first_events = Vec::new();
        let first = analyze(
            &bytes,
            RequestedScreenType::TotalAssets,
            &OcrHints::default(),
            &mut first_recognizer,
            &mut |event| first_events.push(event),
        );
        let mut second_recognizer = DeterministicRecognizer;
        let mut second_events = Vec::new();
        let second = analyze(
            &bytes,
            RequestedScreenType::TotalAssets,
            &OcrHints::default(),
            &mut second_recognizer,
            &mut |event| second_events.push(event),
        );

        assert_eq!(
            first, second,
            "equal inputs and recognition produce equal logic"
        );
        assert_eq!(
            first_events,
            [
                OcrPhaseEvent::Started(OcrPhase::Decode),
                OcrPhaseEvent::Finished(OcrPhase::Decode),
                OcrPhaseEvent::Started(OcrPhase::InitializeEngine),
                OcrPhaseEvent::Finished(OcrPhase::InitializeEngine),
                OcrPhaseEvent::Started(OcrPhase::DetectPlayerOrder),
                OcrPhaseEvent::Finished(OcrPhase::DetectPlayerOrder),
                OcrPhaseEvent::Started(OcrPhase::Parse),
                OcrPhaseEvent::Finished(OcrPhase::Parse),
            ],
            "runtime timing receives boundaries without feeding values into output"
        );
        assert_eq!(first_events, second_events);
    }

    #[test]
    fn decode_failure_precedes_native_engine_initialization() {
        let mut recognizer = UnavailableRecognizer::default();
        let mut events = Vec::new();

        let result = analyze(
            b"not-an-image",
            RequestedScreenType::TotalAssets,
            &OcrHints::default(),
            &mut recognizer,
            &mut |event| events.push(event),
        );

        assert_eq!(result, Err(OcrFailure::DecodeFailed));
        assert_eq!(recognizer.initialize_calls, 0);
        assert_eq!(recognizer.recognize_calls, 0);
        assert_eq!(
            events,
            [
                OcrPhaseEvent::Started(OcrPhase::Decode),
                OcrPhaseEvent::Finished(OcrPhase::Decode),
            ],
            "a malformed image must fail before any native dependency is touched"
        );
    }
}
