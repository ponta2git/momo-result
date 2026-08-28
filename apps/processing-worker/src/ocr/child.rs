//! Stdio adapter for the OCR child process.

use std::io::{self, Read as _, Write};
use std::path::PathBuf;

/// Decodes one OCR request, runs the capability crate, and writes one bounded response.
#[must_use]
pub(crate) fn execute(tessdata_path: Option<PathBuf>) -> i32 {
    let stdin = io::stdin();
    let request = match read_request(stdin.lock()) {
        Ok(request) => request,
        Err(_kind) => return crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE,
    };
    let result = super::native_engine::analyze_local_image_bytes(
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

fn read_request(input: impl io::Read) -> Result<momo_ocr::protocol::OcrRequest, &'static str> {
    let maximum_frame_bytes = momo_ocr::protocol::MAXIMUM_REQUEST_FRAME_BYTES;
    let read_limit = u64::try_from(maximum_frame_bytes)
        .ok()
        .and_then(|value| value.checked_add(1))
        .ok_or("ocr_child_input_bound")?;
    let mut frame = Vec::new();
    input
        .take(read_limit)
        .read_to_end(&mut frame)
        .map_err(|_error| "ocr_child_input_read")?;
    if frame.len() > maximum_frame_bytes {
        return Err("ocr_child_input_frame");
    }
    momo_ocr::protocol::decode_request(crate::process::CHILD_START_MARKER, frame)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn child_stdio_adapter_rejects_a_request_before_reading_beyond_its_bound() {
        let oversized = vec![0_u8; momo_ocr::protocol::MAXIMUM_REQUEST_FRAME_BYTES + 1];
        assert_eq!(
            read_request(Cursor::new(oversized)),
            Err("ocr_child_input_frame")
        );
    }
}
