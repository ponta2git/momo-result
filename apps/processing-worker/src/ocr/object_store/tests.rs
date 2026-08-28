use std::collections::BTreeMap;

use redis::{Value, streams::StreamId};

use super::*;
use crate::ocr::contract::parse_delivery;

const VALID_PAYLOAD: &str =
    include_str!("../../../../../docs/schemas/fixtures/ocr-worker/valid-queue-payload-v2.json");
const PNG_1X1_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

#[test]
fn configuration_rejects_remote_plaintext_and_redacts_credentials() {
    let valid = config("https://account.r2.cloudflarestorage.com");
    assert!(valid.is_ok());
    assert!(matches!(
        config("http://account.r2.cloudflarestorage.com"),
        Err(R2ObjectStoreConfigError::Endpoint)
    ));
    assert!(matches!(
        config("https://account.r2.cloudflarestorage.com/path"),
        Err(R2ObjectStoreConfigError::Endpoint)
    ));
    assert!(matches!(
        config("https://user@account.r2.cloudflarestorage.com"),
        Err(R2ObjectStoreConfigError::Endpoint)
    ));
    assert!(matches!(
        config("https://account.r2.cloudflarestorage.com?query=state"),
        Err(R2ObjectStoreConfigError::Endpoint)
    ));
    assert_eq!(
        format!("{:?}", valid_config(valid)),
        "R2ObjectStoreConfig([REDACTED])"
    );
}

#[test]
fn configuration_enforces_credential_bucket_and_reliability_bounds() {
    for invalid in [
        custom_config(
            "https://account.r2.cloudflarestorage.com",
            "Unsafe_Bucket",
            "access",
            "secret",
            Duration::from_secs(20),
            Duration::from_secs(10),
            2,
        ),
        custom_config(
            "https://account.r2.cloudflarestorage.com",
            "safe-bucket",
            "",
            "secret",
            Duration::from_secs(20),
            Duration::from_secs(10),
            2,
        ),
        custom_config(
            "https://account.r2.cloudflarestorage.com",
            "safe-bucket",
            "access",
            "secret",
            Duration::ZERO,
            Duration::from_secs(10),
            2,
        ),
        custom_config(
            "https://account.r2.cloudflarestorage.com",
            "safe-bucket",
            "access",
            "secret",
            Duration::from_secs(10),
            Duration::from_secs(11),
            2,
        ),
        custom_config(
            "https://account.r2.cloudflarestorage.com",
            "safe-bucket",
            "access",
            "secret",
            Duration::from_secs(20),
            Duration::from_secs(10),
            3,
        ),
    ] {
        assert!(invalid.is_err());
    }
}

#[test]
fn sdk_configuration_pins_retry_timeout_region_and_checksum_policy() {
    let source = valid_config(config("https://account.r2.cloudflarestorage.com"));
    let sdk = build_sdk_config(&source);
    assert_eq!(sdk.retry_config().map(RetryConfig::max_attempts), Some(2));
    assert_eq!(
        sdk.timeout_config()
            .and_then(TimeoutConfig::operation_timeout),
        Some(Duration::from_secs(20))
    );
    assert_eq!(
        sdk.timeout_config()
            .and_then(TimeoutConfig::operation_attempt_timeout),
        Some(Duration::from_secs(10))
    );
    assert_eq!(sdk.region().map(Region::as_ref), Some(REGION));
    assert_eq!(
        sdk.response_checksum_validation(),
        Some(&ResponseChecksumValidation::WhenSupported)
    );
}

#[tokio::test]
async fn bounded_reader_rejects_overrun_and_truncation() {
    let exact = vec![7_u8; 128];
    assert_eq!(
        read_bounded(ByteStream::from(exact.clone()), 128).await,
        Ok(exact)
    );
    assert_eq!(
        read_bounded(ByteStream::from(vec![0_u8; 129]), 128).await,
        Err(OcrObjectStoreError::Integrity)
    );
    assert_eq!(
        read_bounded(ByteStream::from(vec![0_u8; 127]), 128).await,
        Err(OcrObjectStoreError::Integrity)
    );
    assert_eq!(
        read_bounded(ByteStream::from(Vec::new()), 3 * 1024 * 1024 + 1).await,
        Err(OcrObjectStoreError::Integrity)
    );
}

#[test]
fn downloaded_bytes_require_matching_hash_type_and_fullhd_dimensions() {
    let payload = payload();
    let bytes = png_bytes();
    let digest = Sha256::digest(&bytes);
    let sha256 = hex::encode(digest);
    let metadata = DownloadMetadata {
        content_length: i64::try_from(bytes.len()).ok(),
        content_type: Some(String::from("image/png")),
        stored_sha256: Some(sha256.clone()),
        checksum_sha256: Some(BASE64_STANDARD.encode(digest)),
    };
    let payload = payload_with_image_claims(&payload, bytes.len(), &sha256, "image/png");
    let verified = verify_bytes(&payload, &metadata, bytes.clone());
    assert_eq!(verified.as_ref().map(VerifiedSourceImage::width), Ok(1));
    assert_eq!(verified.as_ref().map(VerifiedSourceImage::height), Ok(1));

    let mut tampered = bytes;
    tampered.push(0);
    assert_eq!(
        verify_bytes(&payload, &metadata, tampered),
        Err(OcrObjectStoreError::Integrity)
    );
    let wrong_checksum = DownloadMetadata {
        content_length: i64::try_from(payload.byte_length()).ok(),
        content_type: Some(String::from(payload.media_type().wire())),
        stored_sha256: Some(String::from(payload.sha256())),
        checksum_sha256: Some(BASE64_STANDARD.encode([0_u8; 32])),
    };
    assert_eq!(
        verify_bytes(&payload, &wrong_checksum, png_bytes()),
        Err(OcrObjectStoreError::Integrity)
    );
    let wrong_type =
        payload_with_image_claims(&payload, png_bytes().len(), payload.sha256(), "image/jpeg");
    assert_eq!(
        verify_bytes(&wrong_type, &metadata, png_bytes()),
        Err(OcrObjectStoreError::Integrity)
    );
    assert_eq!(
        validate_dimensions(MAXIMUM_WIDTH + 1, 1),
        Err(OcrObjectStoreError::Integrity)
    );
}

#[test]
fn response_metadata_must_match_every_queue_claim() {
    let payload = payload();
    let metadata = DownloadMetadata {
        content_length: i64::try_from(payload.byte_length()).ok(),
        content_type: Some(String::from(payload.media_type().wire())),
        stored_sha256: Some(String::from(payload.sha256())),
        checksum_sha256: None,
    };
    assert_eq!(validate_response_metadata(&payload, &metadata), Ok(()));
    for wrong in [
        DownloadMetadata {
            content_length: metadata.content_length.map(|length| length + 1),
            content_type: metadata.content_type.clone(),
            stored_sha256: metadata.stored_sha256.clone(),
            checksum_sha256: None,
        },
        DownloadMetadata {
            content_length: metadata.content_length,
            content_type: Some(String::from("image/png")),
            stored_sha256: metadata.stored_sha256.clone(),
            checksum_sha256: None,
        },
        DownloadMetadata {
            content_length: metadata.content_length,
            content_type: metadata.content_type,
            stored_sha256: Some("00".repeat(32)),
            checksum_sha256: None,
        },
    ] {
        assert_eq!(
            validate_response_metadata(&payload, &wrong),
            Err(OcrObjectStoreError::Integrity)
        );
    }
}

fn config(endpoint: &str) -> Result<R2ObjectStoreConfig, R2ObjectStoreConfigError> {
    custom_config(
        endpoint,
        "momo-result-source-images",
        "access",
        "secret",
        Duration::from_secs(20),
        Duration::from_secs(10),
        2,
    )
}

fn custom_config(
    endpoint: &str,
    bucket: &str,
    access_key_id: &str,
    secret_access_key: &str,
    operation_timeout: Duration,
    attempt_timeout: Duration,
    maximum_attempts: u32,
) -> Result<R2ObjectStoreConfig, R2ObjectStoreConfigError> {
    R2ObjectStoreConfig::new(
        endpoint,
        bucket,
        String::from(access_key_id),
        String::from(secret_access_key),
        operation_timeout,
        attempt_timeout,
        maximum_attempts,
    )
}

fn valid_config(
    result: Result<R2ObjectStoreConfig, R2ObjectStoreConfigError>,
) -> R2ObjectStoreConfig {
    match result {
        Ok(config) => config,
        Err(error) => panic!("valid R2 test configuration failed: {error}"),
    }
}

fn payload() -> OcrQueuePayload {
    let fields = match serde_json::from_str::<BTreeMap<String, String>>(VALID_PAYLOAD) {
        Ok(fields) => fields,
        Err(error) => panic!("shared OCR v2 fixture is invalid: {error}"),
    };
    let delivery = StreamId {
        id: String::from("1-0"),
        map: fields
            .into_iter()
            .map(|(key, value)| (key, Value::BulkString(value.into_bytes())))
            .collect(),
    };
    match parse_delivery(&delivery) {
        Ok(payload) => payload,
        Err(error) => panic!("shared OCR v2 fixture violates the contract: {error}"),
    }
}

fn payload_with_image_claims(
    payload: &OcrQueuePayload,
    byte_length: usize,
    sha256: &str,
    media_type: &str,
) -> OcrQueuePayload {
    let fields = BTreeMap::from([
        (String::from("schemaVersion"), String::from("2")),
        (String::from("jobId"), String::from(payload.job_id())),
        (String::from("draftId"), String::from(payload.draft_id())),
        (
            String::from("sourceImageId"),
            String::from(payload.source_image_id()),
        ),
        (
            String::from("imageObjectKey"),
            String::from(payload.image_object_key()),
        ),
        (String::from("sha256"), String::from(sha256)),
        (String::from("byteLength"), byte_length.to_string()),
        (String::from("mediaType"), String::from(media_type)),
        (
            String::from("requestedScreenType"),
            String::from(payload.requested_screen_type().wire()),
        ),
        (String::from("attempt"), String::from("1")),
        (
            String::from("enqueuedAt"),
            String::from("2026-08-11T00:00:00Z"),
        ),
    ]);
    let delivery = StreamId {
        id: String::from("1-0"),
        map: fields
            .into_iter()
            .map(|(key, value)| (key, Value::BulkString(value.into_bytes())))
            .collect(),
    };
    match parse_delivery(&delivery) {
        Ok(parsed) => parsed,
        Err(error) => panic!("image claim fixture violates the contract: {error}"),
    }
}

fn png_bytes() -> Vec<u8> {
    match BASE64_STANDARD.decode(PNG_1X1_BASE64) {
        Ok(bytes) => bytes,
        Err(error) => panic!("fixed PNG fixture is not base64: {error}"),
    }
}
