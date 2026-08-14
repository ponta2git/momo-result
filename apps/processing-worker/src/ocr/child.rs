//! Stdio adapter for the OCR child process.

use std::io::{self, Write};
use std::path::PathBuf;

/// Decodes one OCR request, runs the capability crate, and writes one bounded response.
#[must_use]
pub(crate) fn execute(tessdata_path: Option<PathBuf>) -> i32 {
    let stdin = io::stdin();
    let request = match momo_ocr::protocol::decode_request(
        crate::process::CHILD_START_MARKER,
        stdin.lock(),
    ) {
        Ok(request) => request,
        Err(_kind) => return crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE,
    };
    let result = momo_ocr::analyze_local_image_bytes(
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
