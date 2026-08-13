use serde_json::json;

use super::*;

#[test]
fn control_configuration_requires_a_lease_safety_margin() {
    assert!(
        OcrControlConfig::new(
            String::from("ocr-worker-1"),
            Duration::from_mins(1),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_ok()
    );
    assert!(
        OcrControlConfig::new(
            String::from("bad worker"),
            Duration::from_mins(1),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_err()
    );
    assert!(
        OcrControlConfig::new(
            String::from("ocr-worker-1"),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::from_secs(5),
        )
        .is_err()
    );
}

#[test]
fn failure_vocabulary_stays_compatible_with_the_api_contract() {
    let values = [
        (
            OcrFailureCode::TempImageMissing,
            "TEMP_IMAGE_MISSING",
            false,
        ),
        (OcrFailureCode::InvalidImage, "INVALID_IMAGE", false),
        (
            OcrFailureCode::UnsupportedImageFormat,
            "UNSUPPORTED_IMAGE_FORMAT",
            false,
        ),
        (OcrFailureCode::DecodeFailed, "DECODE_FAILED", false),
        (
            OcrFailureCode::CategoryUndetected,
            "CATEGORY_UNDETECTED",
            false,
        ),
        (
            OcrFailureCode::LayoutUnsupported,
            "LAYOUT_UNSUPPORTED",
            false,
        ),
        (OcrFailureCode::OcrTimeout, "OCR_TIMEOUT", true),
        (
            OcrFailureCode::OcrEngineUnavailable,
            "OCR_ENGINE_UNAVAILABLE",
            true,
        ),
        (OcrFailureCode::ParserFailed, "PARSER_FAILED", false),
        (OcrFailureCode::QueueFailure, "QUEUE_FAILURE", false),
    ];
    for (failure, wire, retryable) in values {
        assert_eq!(failure.wire(), wire);
        assert_eq!(failure.retryable(), retryable);
    }
}

#[test]
fn completion_requires_bounded_object_array_object_json() {
    let valid = OcrDraftCompletion {
        detected_screen_type: RequestedScreenType::TotalAssets,
        profile_id: Some(String::from("momo2-total-assets")),
        payload: json!({"screenType": "total_assets"}),
        warnings: json!([]),
        timings_milliseconds: json!({"total": 10}),
        duration_milliseconds: 10,
    };
    assert!(validate_completion(&valid).is_ok());
    let invalid = OcrDraftCompletion {
        payload: json!([]),
        ..valid
    };
    assert_eq!(
        validate_completion(&invalid)
            .err()
            .map(|error| error.kind()),
        Some("ocr_completion_contract")
    );
}
