//! OCR orchestration boundaries around the isolated `momo-ocr` capability.

pub mod contract;
pub(crate) mod control;
pub mod endurance;
mod isolated_engine;
pub mod object_store;
pub(crate) mod queue;
mod runtime_config;
pub mod worker;

pub use momo_ocr::{OcrFailure, OcrOutput};

#[cfg(target_os = "linux")]
pub(crate) use isolated_engine::IsolatedNativeOcrEngine;
pub use isolated_engine::{analyze_isolated_local_image_bytes, probe_isolated_child_lifecycle};
pub use runtime_config::OcrRuntimeConfigError;
pub(crate) use runtime_config::{
    OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment,
};

#[doc(hidden)]
#[must_use]
pub fn execute_isolated_child(tessdata_path: Option<std::path::PathBuf>) -> i32 {
    use std::io::{self, Write};

    let stdin = io::stdin();
    let request = match momo_ocr::protocol::decode_request(
        crate::process::CHILD_START_MARKER,
        stdin.lock(),
    ) {
        Ok(request) => request,
        Err(_kind) => return crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE,
    };
    let result = momo_ocr::recognize_local_image_bytes(
        tessdata_path,
        &request.image,
        request.requested_screen_type,
        &request.hints,
    );
    let response = match result {
        Ok(ref output) => momo_ocr::protocol::encode_response(Ok(output)),
        Err(failure) => momo_ocr::protocol::encode_response(Err(failure)),
    };
    let response = match response {
        Ok(response) => response,
        Err(_kind) => return crate::process::CHILD_DEPENDENCY_FAILED_EXIT_CODE,
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if output
        .write_all(&response)
        .and_then(|()| output.flush())
        .is_err()
    {
        crate::process::CHILD_DEPENDENCY_FAILED_EXIT_CODE
    } else {
        0
    }
}
