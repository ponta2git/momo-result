//! OCR capability boundary shared by the processing runtime and the isolated OCR child.
//!
//! This crate owns OCR-domain values, deterministic image interpretation, the versioned
//! parent/child protocol, and a checked native-recognition port. Job scheduling, native-engine
//! lifecycle, clocks, filesystems, persistence, retry, and publication policy remain in the outer
//! `momo-processing-worker` crate.

mod contract;
mod core;
mod layout_family;
mod output_contract;
pub mod protocol;
mod result;

pub use contract::{OcrHints, OcrJobInput, OcrMediaType, RequestedScreenType};
pub use core::{
    OcrPhase, OcrPhaseEvent, PageSegmentationMode, RecognitionError, RecognitionFrame,
    RecognitionLanguage, RecognitionPort, RecognizedText, analyze as analyze_image_bytes,
};
pub use result::{InvalidOcrTimings, OcrAnalysis, OcrFailure, OcrOutput, OcrTimings};
