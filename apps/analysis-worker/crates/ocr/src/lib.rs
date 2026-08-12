//! OCR capability boundary shared by the orchestrator and the isolated OCR child.
//!
//! This crate owns OCR-domain values and, as the native implementation is extracted, the
//! versioned parent/child protocol and Tesseract backend. Queue transport, process lifecycle,
//! persistence, retry, and publication policy remain in the outer `momo-analysis` crate.

pub mod contract;
mod core;
mod native_engine;
pub mod protocol;
mod result;

pub use contract::{OcrHints, OcrMediaType, OcrQueuePayload, RequestedScreenType};
pub use native_engine::recognize_local_image_bytes;
pub use result::{OcrFailure, OcrOutput};

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]
mod architecture_tests;
