use std::mem::size_of;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::{OcrFailure, OcrHints, OcrOutput, RequestedScreenType};

/// Version of the OCR parent/child frame contract.
const PROTOCOL_VERSION: u8 = 1;
/// Upper bound for the serialized request header.
const MAXIMUM_HEADER_BYTES: usize = 16 * 1024;
/// Upper bound for the encoded image sent to one child attempt.
const MAXIMUM_IMAGE_BYTES: usize = 3 * 1024 * 1024;
/// Upper bound for one complete parent-to-child request frame.
pub const MAXIMUM_REQUEST_FRAME_BYTES: usize =
    1 + size_of::<u32>() + MAXIMUM_HEADER_BYTES + MAXIMUM_IMAGE_BYTES;
/// Upper bound for one child response.
pub const MAXIMUM_RESPONSE_BYTES: usize = 1024 * 1024;
const MAXIMUM_PROFILE_ID_BYTES: usize = 128;

/// Logical input to one OCR child attempt.
#[derive(Debug, Eq, PartialEq)]
pub struct OcrRequest {
    pub image: Vec<u8>,
    pub requested_screen_type: RequestedScreenType,
    pub hints: OcrHints,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestHeader {
    protocol_version: u8,
    requested_screen_type: String,
    hints: OcrHints,
    image_bytes: u32,
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

/// Encodes the exact OCR request frame, including the caller-owned process start marker.
///
/// The marker is supplied by the outer process boundary so this crate does not own cgroup or
/// parent-liveness policy. The remaining bytes are the versioned OCR protocol.
///
/// # Errors
///
/// Returns a bounded category when the input, header, or frame size is invalid.
pub fn encode_request(
    start_marker: u8,
    image: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
) -> Result<Vec<u8>, &'static str> {
    if image.is_empty() || image.len() > MAXIMUM_IMAGE_BYTES || !hints.is_valid() {
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
    framed.push(start_marker);
    framed.extend_from_slice(&header_bytes.to_be_bytes());
    framed.extend_from_slice(&header);
    framed.extend_from_slice(image);
    Ok(framed)
}

/// Decodes one complete OCR request frame from owned, bounded in-memory bytes.
///
/// The runtime adapter owns stream reads and supplies at most [`MAXIMUM_REQUEST_FRAME_BYTES`]. This
/// decoder remains deterministic, rejects incomplete or trailing bytes, and reuses the frame
/// allocation for the validated image body.
///
/// # Errors
///
/// Returns a closed transport or input-contract category.
pub fn decode_request(start_marker: u8, mut frame: Vec<u8>) -> Result<OcrRequest, &'static str> {
    if frame.len() > MAXIMUM_REQUEST_FRAME_BYTES {
        return Err("ocr_child_input_frame");
    }
    let Some((&marker, framed_payload)) = frame.split_first() else {
        return Err("ocr_child_start_barrier");
    };
    if marker != start_marker {
        return Err("ocr_child_start_barrier");
    }
    let Some((header_length, after_header_length)) =
        framed_payload.split_at_checked(size_of::<u32>())
    else {
        return Err("ocr_child_input_frame");
    };
    let header_length: [u8; size_of::<u32>()] = header_length
        .try_into()
        .map_err(|_error| "ocr_child_input_frame")?;
    let header_length = usize::try_from(u32::from_be_bytes(header_length))
        .map_err(|_error| "ocr_child_input_frame")?;
    if header_length == 0 || header_length > MAXIMUM_HEADER_BYTES {
        return Err("ocr_child_input_frame");
    }
    let Some((header, after_header)) = after_header_length.split_at_checked(header_length) else {
        return Err("ocr_child_input_frame");
    };
    let header: RequestHeader =
        serde_json::from_slice(header).map_err(|_error| "ocr_child_input_decode")?;
    let requested_screen_type = RequestedScreenType::parse_wire(&header.requested_screen_type)
        .ok_or("ocr_child_input_contract")?;
    let image_length =
        usize::try_from(header.image_bytes).map_err(|_error| "ocr_child_input_contract")?;
    if header.protocol_version != PROTOCOL_VERSION
        || image_length == 0
        || image_length > MAXIMUM_IMAGE_BYTES
        || !header.hints.is_valid()
    {
        return Err("ocr_child_input_contract");
    }
    if after_header.len() != image_length {
        return Err("ocr_child_input_frame");
    }
    let image_offset = frame
        .len()
        .checked_sub(after_header.len())
        .ok_or("ocr_child_input_frame")?;
    drop(frame.drain(..image_offset));
    frame.truncate(image_length);
    Ok(OcrRequest {
        image: frame,
        requested_screen_type,
        hints: header.hints,
    })
}

/// Encodes a logical child result without performing stdout I/O.
///
/// # Errors
///
/// Returns a bounded category when the response cannot satisfy the closed wire contract.
pub fn encode_response(result: Result<&OcrOutput, OcrFailure>) -> Result<Vec<u8>, &'static str> {
    let response = match result {
        Ok(output) => ResponseEnvelope::Succeeded {
            detected_screen_type: String::from(output.detected_screen_type.wire()),
            profile_id: output.profile_id.clone(),
            payload: output.payload.clone(),
            warnings: output.warnings.clone(),
            timings_milliseconds: output.timings_milliseconds.clone(),
        },
        Err(failure) => ResponseEnvelope::Failed {
            failure: String::from(failure.wire()),
        },
    };
    let encoded = serde_json::to_vec(&response).map_err(|_error| "ocr_child_output_encode")?;
    if encoded.is_empty() || encoded.len() > MAXIMUM_RESPONSE_BYTES {
        return Err("ocr_child_output_contract");
    }
    Ok(encoded)
}

/// Decodes a complete child response and returns either a domain result or a domain failure.
///
/// # Errors
///
/// Returns a closed transport or output-contract category. A returned `Ok(Err(_))` is a valid
/// child-domain failure and must not be confused with a process-supervision failure.
pub fn decode_response(bytes: &[u8]) -> Result<Result<OcrOutput, OcrFailure>, &'static str> {
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
            Ok(Ok(OcrOutput {
                detected_screen_type,
                profile_id,
                payload,
                warnings,
                timings_milliseconds,
            }))
        }
        ResponseEnvelope::Failed { failure } => OcrFailure::from_wire(&failure)
            .map(Err)
            .ok_or("ocr_child_output_contract"),
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "protocol fixtures abort with precise context when a supposedly valid frame fails"
)]
mod tests {
    use super::*;

    const START_MARKER: u8 = 0x4d;

    #[test]
    fn request_frame_requires_attach_marker_exact_lengths_and_no_trailing_bytes() {
        let frame = encode_request(
            START_MARKER,
            b"bounded-image",
            RequestedScreenType::Revenue,
            &OcrHints::default(),
        )
        .expect("valid request must encode");
        let mut trailing = frame.clone();
        trailing.push(0);
        assert!(decode_request(START_MARKER, trailing).is_err());
        let mut wrong_marker = frame.clone();
        if let Some(marker) = wrong_marker.first_mut() {
            *marker = 0;
        }
        assert!(decode_request(START_MARKER, wrong_marker).is_err());

        let frame_allocation = frame.as_ptr();
        let decoded = decode_request(START_MARKER, frame).expect("valid request must decode");
        assert_eq!(decoded.image, b"bounded-image");
        assert_eq!(decoded.requested_screen_type, RequestedScreenType::Revenue);
        assert_eq!(
            decoded.image.as_ptr(),
            frame_allocation,
            "request decode must reuse the bounded frame allocation for its image"
        );
    }

    #[test]
    fn response_envelope_is_closed_for_success_and_failure() {
        let succeeded = OcrOutput {
            detected_screen_type: RequestedScreenType::TotalAssets,
            profile_id: Some(String::from("full-hd-total-assets-v1")),
            payload: serde_json::json!({"players": []}),
            warnings: serde_json::json!([]),
            timings_milliseconds: serde_json::json!({"total": 1.0}),
        };
        let encoded = encode_response(Ok(&succeeded)).expect("success encodes");
        let encoded_value = serde_json::from_slice::<JsonValue>(&encoded)
            .expect("encoded success response must be JSON");
        assert_eq!(
            encoded_value,
            serde_json::json!({
                "outcome": "succeeded",
                "detected_screen_type": "total_assets",
                "profile_id": "full-hd-total-assets-v1",
                "payload": {"players": []},
                "warnings": [],
                "timings_milliseconds": {"total": 1.0},
            }),
            "response serialization must retain the established version-1 wire field names"
        );
        assert_eq!(decode_response(&encoded), Ok(Ok(succeeded)));

        let failed = encode_response(Err(OcrFailure::DecodeFailed)).expect("failure encodes");
        assert!(matches!(
            decode_response(&failed),
            Ok(Err(OcrFailure::DecodeFailed))
        ));
        assert!(decode_response(br#"{"outcome":"failed","failure":"unknown"}"#).is_err());
        assert!(
            decode_response(br#"{"outcome":"failed","failure":"decode_failed","extra":true}"#)
                .is_err()
        );
    }
}
