use std::path::PathBuf;

use super::{
    contract::{OcrHints, RequestedScreenType},
    core::{CoreOcrError, CoreOcrOutput, analyze},
    object_store::VerifiedSourceImage,
    worker::{OcrEngine, OcrEngineFailure, OcrEngineFuture, OcrEngineOutput},
};

#[derive(Clone, Debug, Default)]
pub struct NativeOcrEngine {
    tessdata_path: Option<PathBuf>,
}

impl NativeOcrEngine {
    #[must_use]
    pub const fn new(tessdata_path: Option<PathBuf>) -> Self {
        Self { tessdata_path }
    }

    /// Runs the in-process OCR core for a bounded local pilot image.
    ///
    /// This entry point performs no queue, object-store, or database side effects. Production
    /// consumption remains controlled by [`super::worker::run_with_engine`].
    ///
    /// # Errors
    ///
    /// Returns a closed OCR failure category when decoding, layout validation, engine startup, or
    /// parsing fails.
    pub fn analyze_local_image_bytes(
        &self,
        bytes: &[u8],
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<OcrEngineOutput, OcrEngineFailure> {
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

impl OcrEngine for NativeOcrEngine {
    fn recognize<'a>(
        &'a self,
        image: &'a VerifiedSourceImage,
        payload: &'a super::contract::OcrQueuePayload,
    ) -> OcrEngineFuture<'a> {
        let bytes = image.bytes().to_vec();
        let requested_screen_type = payload.requested_screen_type();
        let hints = payload.hints().clone();
        let engine = self.clone();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                engine.analyze_local_image_bytes(&bytes, requested_screen_type, &hints)
            })
            .await
            .map_err(|_join_error| OcrEngineFailure::EngineUnavailable)?
        })
    }
}

fn core_output(output: CoreOcrOutput) -> OcrEngineOutput {
    OcrEngineOutput {
        detected_screen_type: output.detected_screen_type,
        profile_id: Some(output.profile_id),
        payload: output.payload,
        warnings: output.warnings,
        timings_milliseconds: output.timings_milliseconds,
    }
}

const fn engine_failure(error: CoreOcrError) -> OcrEngineFailure {
    match error {
        CoreOcrError::Decode => OcrEngineFailure::DecodeFailed,
        CoreOcrError::Layout => OcrEngineFailure::LayoutUnsupported,
        CoreOcrError::EngineUnavailable => OcrEngineFailure::EngineUnavailable,
        CoreOcrError::Parser => OcrEngineFailure::ParserFailed,
    }
}
