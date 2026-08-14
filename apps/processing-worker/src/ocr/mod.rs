//! Durable OCR processing around the isolated `momo-ocr` capability.

pub mod consumer;
pub mod contract;
pub(crate) mod control;
pub mod endurance;
mod isolated_engine;
pub mod object_store;
pub(crate) mod queue;
mod runtime_config;

pub use isolated_engine::probe_isolated_child_lifecycle;
#[cfg(target_os = "linux")]
pub(crate) use isolated_engine::{IsolatedNativeOcrEngine, analyze_isolated_local_image_bytes};
pub use runtime_config::OcrRuntimeConfigError;
pub(crate) use runtime_config::{
    OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment,
};
