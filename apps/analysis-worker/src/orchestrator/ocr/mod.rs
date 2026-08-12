//! OCR orchestration boundaries around the isolated `momo-ocr` capability.

pub mod contract;
pub(crate) mod control;
pub mod endurance;
mod isolated_engine;
pub mod object_store;
pub(crate) mod queue;
mod runtime_config;
pub mod worker;

#[cfg(target_os = "linux")]
pub(crate) use isolated_engine::IsolatedNativeOcrEngine;
pub use isolated_engine::{analyze_isolated_local_image_bytes, probe_isolated_child_lifecycle};
pub use runtime_config::OcrRuntimeConfigError;
pub(crate) use runtime_config::{
    OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment,
};
