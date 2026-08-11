//! OCR runtime boundaries shared by the queue consumer, object store, and isolated OCR child.

mod child_protocol;
pub mod contract;
pub(crate) mod control;
pub(crate) mod core;
mod isolated_engine;
mod native_engine;
pub mod object_store;
pub(crate) mod queue;
mod runtime_config;
pub mod worker;

#[cfg(target_os = "linux")]
pub(crate) use isolated_engine::IsolatedNativeOcrEngine;
pub use isolated_engine::{analyze_isolated_local_image_bytes, probe_isolated_child_lifecycle};
pub use native_engine::NativeOcrEngine;
pub use runtime_config::OcrRuntimeConfigError;
pub(crate) use runtime_config::{
    OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment,
};

#[doc(hidden)]
#[must_use]
pub fn execute_isolated_child(tessdata_path: Option<std::path::PathBuf>) -> i32 {
    child_protocol::execute_child(tessdata_path)
}
