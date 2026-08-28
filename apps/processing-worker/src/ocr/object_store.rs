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

use super::contract::{OcrMediaType, SourceImageClaims};

const REGION: &str = "auto";
const SHA256_METADATA_KEY: &str = "momo-sha256";
const MAXIMUM_IMAGE_BYTES: usize = 3 * 1024 * 1024;
const MAXIMUM_WIDTH: u32 = 1920;
const MAXIMUM_HEIGHT: u32 = 1080;
const MAXIMUM_CREDENTIAL_BYTES: usize = 512;
const MAXIMUM_SESSION_TOKEN_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub(crate) struct R2ObjectStoreConfig {
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
    pub(crate) fn new(
        endpoint: &str,
        bucket: &str,
        access_key_id: String,
        secret_access_key: String,
        operation_timeout: Duration,
        attempt_timeout: Duration,
        maximum_attempts: u32,
    ) -> Result<Self, R2ObjectStoreConfigError> {
        Self::new_with_session_token(
            endpoint,
            bucket,
            access_key_id,
            secret_access_key,
            None,
            operation_timeout,
            attempt_timeout,
            maximum_attempts,
        )
    }

    /// Builds the same fail-closed client with an optional bounded temporary-credential token.
    ///
    /// # Errors
    ///
    /// Returns the same closed configuration categories as [`Self::new`], including an empty or
    /// oversized session token.
    #[expect(
        clippy::too_many_arguments,
        reason = "temporary S3 credentials add one inseparable session token to the closed client configuration"
    )]
    pub(crate) fn new_with_session_token(
        endpoint: &str,
        bucket: &str,
        access_key_id: String,
        secret_access_key: String,
        session_token: Option<String>,
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
        if session_token
            .as_deref()
            .is_some_and(|value| value.is_empty() || value.len() > MAXIMUM_SESSION_TOKEN_BYTES)
        {
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
                session_token,
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
pub(crate) enum R2ObjectStoreConfigError {
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
pub(crate) struct R2ObjectStore {
    client: Client,
    bucket: String,
    download_timeout: Duration,
}

impl fmt::Debug for R2ObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("R2ObjectStore([REDACTED])")
    }
}

impl R2ObjectStore {
    #[must_use]
    pub(crate) fn new(config: &R2ObjectStoreConfig) -> Self {
        Self {
            client: Client::from_conf(build_sdk_config(config)),
            bucket: config.bucket.clone(),
            download_timeout: config.operation_timeout,
        }
    }

    /// Downloads one private object and independently verifies every validated integrity claim.
    ///
    /// # Errors
    ///
    /// Returns a safe failure category for missing or inaccessible objects, bounded dependency
    /// failures, and any byte, checksum, media type, or `FullHD` integrity mismatch.
    pub(crate) async fn download(
        &self,
        claims: &SourceImageClaims,
    ) -> Result<VerifiedSourceImage, OcrObjectStoreError> {
        // The SDK's operation timeout ends when a streaming response is returned, so the adapter
        // must keep the response body under the same end-to-end dependency bound.
        tokio::time::timeout(self.download_timeout, self.download_once(claims))
            .await
            .map_err(|_elapsed| OcrObjectStoreError::Unavailable)?
    }

    async fn download_once(
        &self,
        claims: &SourceImageClaims,
    ) -> Result<VerifiedSourceImage, OcrObjectStoreError> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(claims.object_key())
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
        validate_response_metadata(claims, &metadata)?;
        let bytes = read_bounded(output.body, claims.byte_length()).await?;
        verify_bytes(claims, &metadata, bytes)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedSourceImage {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

impl VerifiedSourceImage {
    #[must_use]
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub(crate) const fn width(&self) -> u32 {
        self.width
    }

    #[must_use]
    pub(crate) const fn height(&self) -> u32 {
        self.height
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(crate) enum OcrObjectStoreError {
    #[error("source image object was not found")]
    NotFound,
    #[error("source image object access was denied")]
    AccessDenied,
    #[error("source image object dependency is unavailable")]
    Unavailable,
    #[error("source image object failed integrity validation")]
    Integrity,
}

#[cfg(target_os = "linux")]
impl OcrObjectStoreError {
    #[must_use]
    pub(crate) const fn kind(self) -> &'static str {
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
    claims: &SourceImageClaims,
    metadata: &DownloadMetadata,
) -> Result<(), OcrObjectStoreError> {
    let expected_length = i64::try_from(claims.byte_length())
        .map_err(|_conversion_error| OcrObjectStoreError::Integrity)?;
    if metadata.content_length != Some(expected_length)
        || metadata.content_type.as_deref() != Some(claims.media_type().wire())
        || metadata.stored_sha256.as_deref() != Some(claims.sha256())
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
    claims: &SourceImageClaims,
    metadata: &DownloadMetadata,
    bytes: Vec<u8>,
) -> Result<VerifiedSourceImage, OcrObjectStoreError> {
    let digest = Sha256::digest(&bytes);
    let actual_sha256 = hex::encode(digest);
    if actual_sha256 != claims.sha256()
        || metadata
            .checksum_sha256
            .as_deref()
            .is_some_and(|checksum| checksum != BASE64_STANDARD.encode(digest))
    {
        return Err(OcrObjectStoreError::Integrity);
    }
    let expected_format = image_format(claims.media_type());
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
mod tests;
