//! Native Tesseract adapter and runtime-owned OCR timing observations.

use std::{path::PathBuf, time::Instant};

use momo_ocr::{
    OcrFailure, OcrHints, OcrOutput, OcrPhase, OcrPhaseEvent, OcrTimings, PageSegmentationMode,
    RecognitionError, RecognitionFrame, RecognitionLanguage, RecognitionPort, RecognizedText,
    RequestedScreenType,
};
use tesseract::{OcrEngineMode, PageSegMode, Tesseract};

/// Runs one bounded in-memory OCR attempt using the process-local native engine.
///
/// The capability crate owns image interpretation. This adapter owns native-library lifecycle and
/// wall-clock observations, neither of which may affect the logical OCR result.
pub(crate) fn analyze_local_image_bytes(
    tessdata_path: Option<PathBuf>,
    bytes: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
) -> Result<OcrOutput, OcrFailure> {
    let total_started = Instant::now();
    let mut recognizer = TesseractRecognizer::new(tessdata_path);
    let mut phases = PhaseTimings::default();
    let analysis = momo_ocr::analyze_image_bytes(
        bytes,
        requested_screen_type,
        hints,
        &mut recognizer,
        &mut |event| phases.observe(event),
    )?;
    let timings = phases
        .finish(total_started.elapsed())
        .ok_or(OcrFailure::ParserFailed)?;
    Ok(analysis.with_timings(timings))
}

struct TesseractRecognizer {
    tessdata_path: Option<PathBuf>,
    general: Option<Tesseract>,
    incident_digits: Option<Tesseract>,
}

impl TesseractRecognizer {
    const fn new(tessdata_path: Option<PathBuf>) -> Self {
        Self {
            tessdata_path,
            general: None,
            incident_digits: None,
        }
    }

    fn take_or_initialize(
        &mut self,
        language: RecognitionLanguage,
    ) -> Result<Tesseract, RecognitionError> {
        let slot = match language {
            RecognitionLanguage::General => &mut self.general,
            RecognitionLanguage::IncidentDigits => &mut self.incident_digits,
        };
        if let Some(engine) = slot.take() {
            return Ok(engine);
        }
        let language_name = match language {
            RecognitionLanguage::General => "jpn+eng",
            RecognitionLanguage::IncidentDigits => "eng",
        };
        initialize(self.tessdata_path.as_deref(), language_name, language)
    }

    fn put(&mut self, language: RecognitionLanguage, engine: Tesseract) {
        match language {
            RecognitionLanguage::General => self.general = Some(engine),
            RecognitionLanguage::IncidentDigits => self.incident_digits = Some(engine),
        }
    }
}

impl RecognitionPort for TesseractRecognizer {
    fn initialize(&mut self) -> Result<(), RecognitionError> {
        if self.general.is_none() {
            self.general = Some(initialize(
                self.tessdata_path.as_deref(),
                "jpn+eng",
                RecognitionLanguage::General,
            )?);
        }
        Ok(())
    }

    fn recognize(
        &mut self,
        frame: RecognitionFrame<'_>,
        language: RecognitionLanguage,
        segmentation: PageSegmentationMode,
    ) -> Result<RecognizedText, RecognitionError> {
        // The native wrapper consumes its handle while setting an image. Keeping each engine in an
        // Option makes that ownership transfer explicit and restores reusable state only on success.
        let mut engine = self.take_or_initialize(language)?;
        engine.set_page_seg_mode(page_segmentation_mode(segmentation));
        let mut engine = engine
            .set_frame(
                frame.bytes(),
                frame.width(),
                frame.height(),
                frame.bytes_per_pixel(),
                frame.bytes_per_line(),
            )
            .map_err(recognition_failure)?
            .recognize()
            .map_err(recognition_failure)?;
        let text = engine.get_text().map_err(recognition_failure)?;
        let confidence = engine.mean_text_conf();
        self.put(language, engine);
        Ok(RecognizedText::new(
            &text,
            (confidence >= 0).then(|| f64::from(confidence) / 100.0),
        ))
    }
}

fn initialize(
    tessdata_path: Option<&std::path::Path>,
    language_name: &str,
    language: RecognitionLanguage,
) -> Result<Tesseract, RecognitionError> {
    let path = tessdata_path.and_then(std::path::Path::to_str);
    let engine = Tesseract::new_with_oem(path, Some(language_name), OcrEngineMode::LstmOnly)
        .map_err(initialization_failure_for_port)?;
    if matches!(language, RecognitionLanguage::IncidentDigits) {
        engine
            .set_variable("tessedit_char_whitelist", "0123456789OoIl|i")
            .map_err(initialization_failure_for_port)
    } else {
        Ok(engine)
    }
}

fn initialization_failure_for_port<E>(_error: E) -> RecognitionError {
    RecognitionError::EngineUnavailable
}

fn recognition_failure<E>(_error: E) -> RecognitionError {
    RecognitionError::RecognitionFailed
}

const fn page_segmentation_mode(mode: PageSegmentationMode) -> PageSegMode {
    match mode {
        PageSegmentationMode::SingleBlock => PageSegMode::PsmSingleBlock,
        PageSegmentationMode::SingleLine => PageSegMode::PsmSingleLine,
        PageSegmentationMode::SingleWord => PageSegMode::PsmSingleWord,
        PageSegmentationMode::SingleChar => PageSegMode::PsmSingleChar,
        PageSegmentationMode::SparseText => PageSegMode::PsmSparseText,
        PageSegmentationMode::RawLine => PageSegMode::PsmRawLine,
    }
}

#[derive(Default)]
struct PhaseTimings {
    active: Option<(OcrPhase, Instant)>,
    decode_milliseconds: Option<f64>,
    engine_initialization_milliseconds: Option<f64>,
    detect_player_order_milliseconds: Option<f64>,
    parse_milliseconds: Option<f64>,
    invalid: bool,
}

impl PhaseTimings {
    fn observe(&mut self, event: OcrPhaseEvent) {
        match event {
            OcrPhaseEvent::Started(phase) => self.start(phase),
            OcrPhaseEvent::Finished(phase) => self.stop(phase),
        }
    }

    fn start(&mut self, phase: OcrPhase) {
        if self.active.is_some() || self.completed(phase) {
            self.invalid = true;
            return;
        }
        self.active = Some((phase, Instant::now()));
    }

    fn stop(&mut self, phase: OcrPhase) {
        let Some((active, started)) = self.active.take() else {
            self.invalid = true;
            return;
        };
        if active != phase || self.completed(phase) {
            self.invalid = true;
            return;
        }
        let elapsed = milliseconds(started.elapsed());
        match phase {
            OcrPhase::Decode => self.decode_milliseconds = Some(elapsed),
            OcrPhase::InitializeEngine => self.engine_initialization_milliseconds = Some(elapsed),
            OcrPhase::DetectPlayerOrder => self.detect_player_order_milliseconds = Some(elapsed),
            OcrPhase::Parse => self.parse_milliseconds = Some(elapsed),
        }
    }

    const fn completed(&self, phase: OcrPhase) -> bool {
        match phase {
            OcrPhase::Decode => self.decode_milliseconds.is_some(),
            OcrPhase::InitializeEngine => self.engine_initialization_milliseconds.is_some(),
            OcrPhase::DetectPlayerOrder => self.detect_player_order_milliseconds.is_some(),
            OcrPhase::Parse => self.parse_milliseconds.is_some(),
        }
    }

    fn finish(self, total: std::time::Duration) -> Option<OcrTimings> {
        if self.invalid || self.active.is_some() {
            return None;
        }
        OcrTimings::new(
            self.decode_milliseconds?,
            self.engine_initialization_milliseconds?,
            self.detect_player_order_milliseconds?,
            self.parse_milliseconds?,
            milliseconds(total),
        )
        .ok()
    }
}

fn milliseconds(duration: std::time::Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn segmentation_modes_are_mapped_without_numeric_coercion() {
        let cases = [
            (
                PageSegmentationMode::SingleBlock,
                PageSegMode::PsmSingleBlock,
            ),
            (PageSegmentationMode::SingleLine, PageSegMode::PsmSingleLine),
            (PageSegmentationMode::SingleWord, PageSegMode::PsmSingleWord),
            (PageSegmentationMode::SingleChar, PageSegMode::PsmSingleChar),
            (PageSegmentationMode::SparseText, PageSegMode::PsmSparseText),
            (PageSegmentationMode::RawLine, PageSegMode::PsmRawLine),
        ];
        for (domain, native) in cases {
            assert_eq!(
                page_segmentation_mode(domain),
                native,
                "each domain mode must map to its exact native equivalent"
            );
        }
    }

    #[test]
    fn completed_phase_sequence_produces_valid_complete_timings() {
        let mut timings = PhaseTimings::default();
        for phase in [
            OcrPhase::Decode,
            OcrPhase::InitializeEngine,
            OcrPhase::DetectPlayerOrder,
            OcrPhase::Parse,
        ] {
            timings.observe(OcrPhaseEvent::Started(phase));
            timings.observe(OcrPhaseEvent::Finished(phase));
        }
        assert!(
            timings.finish(Duration::from_secs(1)).is_some(),
            "a complete phase sequence must produce valid typed timings"
        );
    }

    #[test]
    fn invalid_phase_sequence_fails_closed() {
        let mut timings = PhaseTimings::default();
        timings.observe(OcrPhaseEvent::Finished(OcrPhase::Decode));
        assert!(
            timings.finish(Duration::ZERO).is_none(),
            "a capability/runtime observer contract violation must not emit partial timings"
        );
    }
}
