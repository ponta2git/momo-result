use std::path::PathBuf;

use crate::{
    OcrFailure, OcrHints, OcrOutput, RequestedScreenType,
    core::{CoreOcrError, CoreOcrOutput, analyze},
};

#[derive(Clone, Debug, Default)]
struct NativeOcrEngine {
    tessdata_path: Option<PathBuf>,
}

impl NativeOcrEngine {
    #[must_use]
    const fn new(tessdata_path: Option<PathBuf>) -> Self {
        Self { tessdata_path }
    }

    /// Runs the OCR capability for one bounded local image.
    ///
    /// # Errors
    ///
    /// Returns a closed OCR failure category when decoding, layout validation, engine startup, or
    /// parsing fails.
    fn analyze_local_image_bytes(
        &self,
        bytes: &[u8],
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<OcrOutput, OcrFailure> {
        analyze(
            bytes,
            requested_screen_type,
            hints,
            self.tessdata_path.clone(),
        )
        .map(core_output)
        .map_err(engine_failure)
    }
}

fn core_output(output: CoreOcrOutput) -> OcrOutput {
    OcrOutput {
        detected_screen_type: output.detected_screen_type,
        profile_id: Some(output.profile_id),
        payload: output.payload,
        warnings: output.warnings,
        timings_milliseconds: output.timings_milliseconds,
    }
}

const fn engine_failure(error: CoreOcrError) -> OcrFailure {
    match error {
        CoreOcrError::Decode => OcrFailure::DecodeFailed,
        CoreOcrError::Layout => OcrFailure::LayoutUnsupported,
        CoreOcrError::EngineUnavailable => OcrFailure::EngineUnavailable,
        CoreOcrError::Parser => OcrFailure::ParserFailed,
    }
}

/// Runs the hidden native backend behind a narrow capability API.
///
/// # Errors
///
/// Returns the closed OCR domain failure vocabulary for decode, layout, native engine, or parser
/// failures.
pub fn recognize_local_image_bytes(
    tessdata_path: Option<PathBuf>,
    bytes: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
) -> Result<OcrOutput, OcrFailure> {
    NativeOcrEngine::new(tessdata_path).analyze_local_image_bytes(
        bytes,
        requested_screen_type,
        hints,
    )
}
