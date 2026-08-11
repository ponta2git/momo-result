use std::{fmt, io::Cursor, time::Duration};

use aws_sdk_s3::{
    Client,
    config::{
        Credentials, Region, ResponseChecksumValidation, retry::RetryConfig, timeout::TimeoutConfig,
    },
    error::SdkError,
    operation::get_object::GetObjectError,
    primitives::ByteStream,
    types::ChecksumMode,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use image::{ImageFormat, ImageReader};
use sha2::{Digest as _, Sha256};
use thiserror::Error;
use url::Url;

use super::contract::{OcrMediaType, OcrQueuePayload};

const REGION: &str = "auto";
const SHA256_METADATA_KEY: &str = "momo-sha256";
const MAXIMUM_IMAGE_BYTES: usize = 3 * 1024 * 1024;
const MAXIMUM_WIDTH: u32 = 1920;
const MAXIMUM_HEIGHT: u32 = 1080;
const MAXIMUM_CREDENTIAL_BYTES: usize = 512;

#[derive(Clone)]
pub struct R2ObjectStoreConfig {
    endpoint: String,
    bucket: String,
    credentials: Credentials,
    operation_timeout: Duration,
    attempt_timeout: Duration,
    maximum_attempts: u32,
}

impl fmt::Debug for R2ObjectStoreConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("R2ObjectStoreConfig([REDACTED])")
    }
}

impl R2ObjectStoreConfig {
    pub(crate) const fn operation_timeout(&self) -> Duration {
        self.operation_timeout
    }

    /// Builds a fail-closed private R2 client configuration.
    ///
    /// # Errors
    ///
    /// Returns an error for remote plaintext endpoints, unsafe bucket names, credentials outside
    /// their structural bounds, missing timeouts, or more than two SDK attempts.
    pub fn new(
        endpoint: &str,
        bucket: &str,
        access_key_id: String,
        secret_access_key: String,
        operation_timeout: Duration,
        attempt_timeout: Duration,
        maximum_attempts: u32,
    ) -> Result<Self, R2ObjectStoreConfigError> {
        let endpoint = validated_endpoint(endpoint)?;
        if !valid_bucket(bucket) {
            return Err(R2ObjectStoreConfigError::Bucket);
        }
        if !valid_credential(&access_key_id) || !valid_credential(&secret_access_key) {
            return Err(R2ObjectStoreConfigError::Credentials);
        }
        if operation_timeout.is_zero()
            || attempt_timeout.is_zero()
            || operation_timeout < attempt_timeout
            || !(1..=2).contains(&maximum_attempts)
        {
            return Err(R2ObjectStoreConfigError::ReliabilityBounds);
        }
        Ok(Self {
            endpoint,
            bucket: String::from(bucket),
            credentials: Credentials::new(
                access_key_id,
                secret_access_key,
                None,
                None,
                "momo-r2-object-store",
            ),
            operation_timeout,
            attempt_timeout,
            maximum_attempts,
        })
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum R2ObjectStoreConfigError {
    #[error("R2 endpoint must be remote HTTPS or a loopback test endpoint without URL state")]
    Endpoint,
    #[error("R2 bucket name is invalid")]
    Bucket,
    #[error("R2 credentials violate their structural bounds")]
    Credentials,
    #[error("R2 timeout or retry bounds are unsafe")]
    ReliabilityBounds,
}

#[derive(Clone)]
pub struct R2ObjectStore {
    client: Client,
    bucket: String,
}

impl fmt::Debug for R2ObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("R2ObjectStore([REDACTED])")
    }
}

impl R2ObjectStore {
    #[must_use]
    pub fn new(config: &R2ObjectStoreConfig) -> Self {
        Self {
            client: Client::from_conf(build_sdk_config(config)),
            bucket: config.bucket.clone(),
        }
    }

    /// Downloads one private object and independently verifies every queue metadata claim.
    ///
    /// # Errors
    ///
    /// Returns a safe failure category for missing or inaccessible objects, bounded dependency
    /// failures, and any byte, checksum, media type, or `FullHD` integrity mismatch.
    pub async fn download(
        &self,
        payload: &OcrQueuePayload,
    ) -> Result<VerifiedSourceImage, OcrObjectStoreError> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(payload.image_object_key())
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await
            .map_err(|error| classify_get_error(&error))?;
        let metadata = DownloadMetadata {
            content_length: output.content_length(),
            content_type: output.content_type().map(String::from),
            stored_sha256: output
                .metadata()
                .and_then(|metadata| metadata.get(SHA256_METADATA_KEY))
                .map(String::from),
            checksum_sha256: output.checksum_sha256().map(String::from),
        };
        validate_response_metadata(payload, &metadata)?;
        let bytes = read_bounded(output.body, payload.byte_length()).await?;
        verify_bytes(payload, &metadata, bytes)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedSourceImage {
    bytes: Vec<u8>,
    media_type: OcrMediaType,
    width: u32,
    height: u32,
}

impl VerifiedSourceImage {
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub const fn media_type(&self) -> OcrMediaType {
        self.media_type
    }

    #[must_use]
    pub const fn width(&self) -> u32 {
        self.width
    }

    #[must_use]
    pub const fn height(&self) -> u32 {
        self.height
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum OcrObjectStoreError {
    #[error("source image object was not found")]
    NotFound,
    #[error("source image object access was denied")]
    AccessDenied,
    #[error("source image object dependency is unavailable")]
    Unavailable,
    #[error("source image object failed integrity validation")]
    Integrity,
}

impl OcrObjectStoreError {
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::NotFound => "object_not_found",
            Self::AccessDenied => "object_access_denied",
            Self::Unavailable => "object_unavailable",
            Self::Integrity => "object_integrity",
        }
    }
}

struct DownloadMetadata {
    content_length: Option<i64>,
    content_type: Option<String>,
    stored_sha256: Option<String>,
    checksum_sha256: Option<String>,
}

fn validated_endpoint(value: &str) -> Result<String, R2ObjectStoreConfigError> {
    let endpoint = Url::parse(value).map_err(|_error| R2ObjectStoreConfigError::Endpoint)?;
    let host = endpoint
        .host_str()
        .ok_or(R2ObjectStoreConfigError::Endpoint)?;
    let remote_https = endpoint.scheme() == "https";
    let loopback_http =
        endpoint.scheme() == "http" && matches!(host, "localhost" | "127.0.0.1" | "::1");
    let stateless = endpoint.username().is_empty()
        && endpoint.password().is_none()
        && (endpoint.path().is_empty() || endpoint.path() == "/")
        && endpoint.query().is_none()
        && endpoint.fragment().is_none();
    if (remote_https || loopback_http) && stateless {
        Ok(endpoint.to_string())
    } else {
        Err(R2ObjectStoreConfigError::Endpoint)
    }
}

fn valid_bucket(value: &str) -> bool {
    (3..=63).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value
            .bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

const fn valid_credential(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAXIMUM_CREDENTIAL_BYTES
}

fn build_sdk_config(config: &R2ObjectStoreConfig) -> aws_sdk_s3::Config {
    let timeout_config = TimeoutConfig::builder()
        .operation_timeout(config.operation_timeout)
        .operation_attempt_timeout(config.attempt_timeout)
        .build();
    let retry_config = RetryConfig::standard().with_max_attempts(config.maximum_attempts);
    aws_sdk_s3::Config::builder()
        .behavior_version_latest()
        .endpoint_url(&config.endpoint)
        .region(Region::new(REGION))
        .credentials_provider(config.credentials.clone())
        .force_path_style(true)
        .retry_config(retry_config)
        .timeout_config(timeout_config)
        .response_checksum_validation(ResponseChecksumValidation::WhenSupported)
        .build()
}

fn classify_get_error(error: &SdkError<GetObjectError>) -> OcrObjectStoreError {
    let status = error
        .raw_response()
        .map(|response| response.status().as_u16());
    match status {
        Some(401 | 403) => OcrObjectStoreError::AccessDenied,
        Some(404) => OcrObjectStoreError::NotFound,
        Some(_) | None => OcrObjectStoreError::Unavailable,
    }
}

fn validate_response_metadata(
    payload: &OcrQueuePayload,
    metadata: &DownloadMetadata,
) -> Result<(), OcrObjectStoreError> {
    let expected_length = i64::try_from(payload.byte_length())
        .map_err(|_conversion_error| OcrObjectStoreError::Integrity)?;
    if metadata.content_length != Some(expected_length)
        || metadata.content_type.as_deref() != Some(payload.media_type().wire())
        || metadata.stored_sha256.as_deref() != Some(payload.sha256())
    {
        return Err(OcrObjectStoreError::Integrity);
    }
    Ok(())
}

async fn read_bounded(
    mut body: ByteStream,
    expected_length: u64,
) -> Result<Vec<u8>, OcrObjectStoreError> {
    let expected = usize::try_from(expected_length)
        .ok()
        .filter(|length| *length <= MAXIMUM_IMAGE_BYTES)
        .ok_or(OcrObjectStoreError::Integrity)?;
    let mut bytes = Vec::with_capacity(expected);
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_stream_error| OcrObjectStoreError::Unavailable)?;
        let next_length = bytes
            .len()
            .checked_add(chunk.len())
            .ok_or(OcrObjectStoreError::Integrity)?;
        if next_length > expected || next_length > MAXIMUM_IMAGE_BYTES {
            return Err(OcrObjectStoreError::Integrity);
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() == expected {
        Ok(bytes)
    } else {
        Err(OcrObjectStoreError::Integrity)
    }
}

fn verify_bytes(
    payload: &OcrQueuePayload,
    metadata: &DownloadMetadata,
    bytes: Vec<u8>,
) -> Result<VerifiedSourceImage, OcrObjectStoreError> {
    let digest = Sha256::digest(&bytes);
    let actual_sha256 = hex::encode(digest);
    if actual_sha256 != payload.sha256()
        || metadata
            .checksum_sha256
            .as_deref()
            .is_some_and(|checksum| checksum != BASE64_STANDARD.encode(digest))
    {
        return Err(OcrObjectStoreError::Integrity);
    }
    let expected_format = image_format(payload.media_type());
    let detected_format =
        image::guess_format(&bytes).map_err(|_error| OcrObjectStoreError::Integrity)?;
    if detected_format != expected_format {
        return Err(OcrObjectStoreError::Integrity);
    }
    let reader = ImageReader::with_format(Cursor::new(&bytes), detected_format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_error| OcrObjectStoreError::Integrity)?;
    validate_dimensions(width, height)?;
    Ok(VerifiedSourceImage {
        bytes,
        media_type: payload.media_type(),
        width,
        height,
    })
}

const fn image_format(media_type: OcrMediaType) -> ImageFormat {
    match media_type {
        OcrMediaType::Png => ImageFormat::Png,
        OcrMediaType::Jpeg => ImageFormat::Jpeg,
        OcrMediaType::Webp => ImageFormat::WebP,
    }
}

const fn validate_dimensions(width: u32, height: u32) -> Result<(), OcrObjectStoreError> {
    if width == 0 || height == 0 || width > MAXIMUM_WIDTH || height > MAXIMUM_HEIGHT {
        Err(OcrObjectStoreError::Integrity)
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "checked-in queue fixture and fixed PNG test data must expose parse failures"
)]
mod tests {
    use std::collections::BTreeMap;

    use redis::{Value, streams::StreamId};

    use super::*;
    use crate::ocr::contract::parse_delivery;

    const VALID_PAYLOAD: &str =
        include_str!("../../../../docs/schemas/fixtures/ocr-worker/valid-queue-payload-v2.json");
    const PNG_1X1_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
        let rendered = format!("{:?}", valid_config(valid));
        assert!(!rendered.contains("access"));
        assert!(!rendered.contains("secret"));
        assert!(!rendered.contains("account.r2"));
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
            (String::from("attempt"), payload.attempt().to_string()),
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
}
