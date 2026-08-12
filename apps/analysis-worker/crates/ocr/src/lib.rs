//! OCR capability boundary shared by the orchestrator and the isolated OCR child.
//!
//! This crate owns OCR-domain values and, as the native implementation is extracted, the
//! versioned parent/child protocol and Tesseract backend. Queue transport, process lifecycle,
//! persistence, retry, and publication policy remain in the outer `momo-analysis` crate.

pub mod contract;
mod result;

pub use contract::{OcrHints, OcrMediaType, OcrQueuePayload, RequestedScreenType};
pub use result::{OcrFailure, OcrOutput};
