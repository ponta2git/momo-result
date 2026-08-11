use std::{
    io::{self, Read, Write},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[cfg(any(target_os = "linux", test))]
use super::worker::OcrEngineOutput;
use super::{
    NativeOcrEngine,
    contract::{OcrHints, RequestedScreenType},
    worker::OcrEngineFailure,
};

const PROTOCOL_VERSION: u8 = 1;
const MAXIMUM_HEADER_BYTES: usize = 16 * 1024;
pub(super) const MAXIMUM_IMAGE_BYTES: usize = 3 * 1024 * 1024;
pub(super) const MAXIMUM_RESPONSE_BYTES: usize = 1024 * 1024;
#[cfg(any(target_os = "linux", test))]
const MAXIMUM_PROFILE_ID_BYTES: usize = 128;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestHeader {
    protocol_version: u8,
    requested_screen_type: String,
    hints: OcrHints,
    image_bytes: u32,
}

pub(super) struct DecodedRequest {
    pub(super) image: Vec<u8>,
    pub(super) requested_screen_type: RequestedScreenType,
    pub(super) hints: OcrHints,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase", tag = "outcome")]
enum ResponseEnvelope {
    #[serde(rename = "succeeded")]
    Succeeded {
        detected_screen_type: String,
        profile_id: Option<String>,
        payload: JsonValue,
        warnings: JsonValue,
        timings_milliseconds: JsonValue,
    },
    #[serde(rename = "failed")]
    Failed { failure: String },
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn encode_request(
    image: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
) -> Result<Vec<u8>, &'static str> {
    if image.is_empty() || image.len() > MAXIMUM_IMAGE_BYTES || !hints.validate() {
        return Err("ocr_child_input_contract");
    }
    let image_bytes = u32::try_from(image.len()).map_err(|_error| "ocr_child_input_contract")?;
    let header = serde_json::to_vec(&RequestHeader {
        protocol_version: PROTOCOL_VERSION,
        requested_screen_type: String::from(requested_screen_type.wire()),
        hints: hints.clone(),
        image_bytes,
    })
    .map_err(|_error| "ocr_child_input_encode")?;
    if header.is_empty() || header.len() > MAXIMUM_HEADER_BYTES {
        return Err("ocr_child_input_contract");
    }
    let header_bytes = u32::try_from(header.len()).map_err(|_error| "ocr_child_input_contract")?;
    let capacity = 1_usize
        .checked_add(size_of::<u32>())
        .and_then(|value| value.checked_add(header.len()))
        .and_then(|value| value.checked_add(image.len()))
        .ok_or("ocr_child_input_contract")?;
    let mut framed = Vec::with_capacity(capacity);
    framed.push(crate::process::CHILD_START_MARKER);
    framed.extend_from_slice(&header_bytes.to_be_bytes());
    framed.extend_from_slice(&header);
    framed.extend_from_slice(image);
    Ok(framed)
}

fn decode_request(mut input: impl Read) -> Result<DecodedRequest, &'static str> {
    let mut marker = [0_u8; 1];
    input
        .read_exact(&mut marker)
        .map_err(|_error| "ocr_child_start_barrier")?;
    if marker != [crate::process::CHILD_START_MARKER] {
        return Err("ocr_child_start_barrier");
    }
    let mut header_length = [0_u8; size_of::<u32>()];
    input
        .read_exact(&mut header_length)
        .map_err(|_error| "ocr_child_input_frame")?;
    let header_length = usize::try_from(u32::from_be_bytes(header_length))
        .map_err(|_error| "ocr_child_input_frame")?;
    if header_length == 0 || header_length > MAXIMUM_HEADER_BYTES {
        return Err("ocr_child_input_frame");
    }
    let mut header = vec![0_u8; header_length];
    input
        .read_exact(&mut header)
        .map_err(|_error| "ocr_child_input_frame")?;
    let header: RequestHeader =
        serde_json::from_slice(&header).map_err(|_error| "ocr_child_input_decode")?;
    let requested_screen_type = RequestedScreenType::parse_wire(&header.requested_screen_type)
        .ok_or("ocr_child_input_contract")?;
    let image_length =
        usize::try_from(header.image_bytes).map_err(|_error| "ocr_child_input_contract")?;
    if header.protocol_version != PROTOCOL_VERSION
        || image_length == 0
        || image_length > MAXIMUM_IMAGE_BYTES
        || !header.hints.validate()
    {
        return Err("ocr_child_input_contract");
    }
    let mut image = vec![0_u8; image_length];
    input
        .read_exact(&mut image)
        .map_err(|_error| "ocr_child_input_frame")?;
    let mut trailing = [0_u8; 1];
    if input
        .read(&mut trailing)
        .map_err(|_error| "ocr_child_input_frame")?
        != 0
    {
        return Err("ocr_child_input_frame");
    }
    Ok(DecodedRequest {
        image,
        requested_screen_type,
        hints: header.hints,
    })
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn decode_response(
    bytes: &[u8],
) -> Result<Result<OcrEngineOutput, OcrEngineFailure>, &'static str> {
    if bytes.is_empty() || bytes.len() > MAXIMUM_RESPONSE_BYTES {
        return Err("ocr_child_output_contract");
    }
    let envelope: ResponseEnvelope =
        serde_json::from_slice(bytes).map_err(|_error| "ocr_child_output_decode")?;
    match envelope {
        ResponseEnvelope::Succeeded {
            detected_screen_type,
            profile_id,
            payload,
            warnings,
            timings_milliseconds,
        } => {
            let detected_screen_type = RequestedScreenType::parse_wire(&detected_screen_type)
                .ok_or("ocr_child_output_contract")?;
            if profile_id
                .as_ref()
                .is_some_and(|value| value.is_empty() || value.len() > MAXIMUM_PROFILE_ID_BYTES)
            {
                return Err("ocr_child_output_contract");
            }
            Ok(Ok(OcrEngineOutput {
                detected_screen_type,
                profile_id,
                payload,
                warnings,
                timings_milliseconds,
            }))
        }
        ResponseEnvelope::Failed { failure } => parse_failure(&failure)
            .map(Err)
            .ok_or("ocr_child_output_contract"),
    }
}

pub(super) fn execute_child(tessdata_path: Option<PathBuf>) -> i32 {
    let stdin = io::stdin();
    let request = match decode_request(stdin.lock()) {
        Ok(request) => request,
        Err(_kind) => return crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE,
    };
    let result = NativeOcrEngine::new(tessdata_path).analyze_local_image_bytes(
        &request.image,
        request.requested_screen_type,
        &request.hints,
    );
    let response = match result {
        Ok(output) => ResponseEnvelope::Succeeded {
            detected_screen_type: String::from(output.detected_screen_type.wire()),
            profile_id: output.profile_id,
            payload: output.payload,
            warnings: output.warnings,
            timings_milliseconds: output.timings_milliseconds,
        },
        Err(failure) => ResponseEnvelope::Failed {
            failure: String::from(failure_wire(failure)),
        },
    };
    if write_response(&response).is_err() {
        crate::process::CHILD_DEPENDENCY_FAILED_EXIT_CODE
    } else {
        0
    }
}

fn write_response(response: &ResponseEnvelope) -> Result<(), &'static str> {
    let encoded = serde_json::to_vec(response).map_err(|_error| "ocr_child_output_encode")?;
    if encoded.is_empty() || encoded.len() > MAXIMUM_RESPONSE_BYTES {
        return Err("ocr_child_output_contract");
    }
    let stdout = io::stdout();
    let mut output = stdout.lock();
    output
        .write_all(&encoded)
        .and_then(|()| output.flush())
        .map_err(|_error| "ocr_child_output_write")
}

const fn failure_wire(failure: OcrEngineFailure) -> &'static str {
    match failure {
        OcrEngineFailure::InvalidImage => "invalid_image",
        OcrEngineFailure::UnsupportedImageFormat => "unsupported_image_format",
        OcrEngineFailure::DecodeFailed => "decode_failed",
        OcrEngineFailure::CategoryUndetected => "category_undetected",
        OcrEngineFailure::LayoutUnsupported => "layout_unsupported",
        OcrEngineFailure::EngineUnavailable => "engine_unavailable",
        OcrEngineFailure::ParserFailed => "parser_failed",
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_failure(value: &str) -> Option<OcrEngineFailure> {
    match value {
        "invalid_image" => Some(OcrEngineFailure::InvalidImage),
        "unsupported_image_format" => Some(OcrEngineFailure::UnsupportedImageFormat),
        "decode_failed" => Some(OcrEngineFailure::DecodeFailed),
        "category_undetected" => Some(OcrEngineFailure::CategoryUndetected),
        "layout_unsupported" => Some(OcrEngineFailure::LayoutUnsupported),
        "engine_unavailable" => Some(OcrEngineFailure::EngineUnavailable),
        "parser_failed" => Some(OcrEngineFailure::ParserFailed),
        _ => None,
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "protocol fixtures abort with precise context when a supposedly valid frame fails"
)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn request_frame_requires_attach_marker_exact_lengths_and_no_trailing_bytes() {
        let frame = encode_request(
            b"bounded-image",
            RequestedScreenType::Revenue,
            &OcrHints::default(),
        )
        .expect("valid request must encode");
        let decoded = decode_request(Cursor::new(&frame)).expect("valid request must decode");
        assert_eq!(decoded.image, b"bounded-image");
        assert_eq!(decoded.requested_screen_type, RequestedScreenType::Revenue);

        let mut trailing = frame.clone();
        trailing.push(0);
        assert!(decode_request(Cursor::new(trailing)).is_err());
        let mut wrong_marker = frame;
        if let Some(marker) = wrong_marker.first_mut() {
            *marker = 0;
        }
        assert!(decode_request(Cursor::new(wrong_marker)).is_err());
    }

    #[test]
    fn response_envelope_is_closed_for_success_and_failure() {
        let failed = serde_json::to_vec(&ResponseEnvelope::Failed {
            failure: String::from("decode_failed"),
        })
        .expect("failure response must encode");
        assert!(matches!(
            decode_response(&failed),
            Ok(Err(OcrEngineFailure::DecodeFailed))
        ));
        assert!(decode_response(br#"{"outcome":"failed","failure":"unknown"}"#).is_err());
        assert!(
            decode_response(br#"{"outcome":"failed","failure":"decode_failed","extra":true}"#)
                .is_err()
        );
    }
}
