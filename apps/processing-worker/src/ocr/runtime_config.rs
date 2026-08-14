use std::{env, time::Duration};

use thiserror::Error;

use super::{
    consumer::{OcrConsumerConfig, OcrConsumerError},
    object_store::{R2ObjectStoreConfig, R2ObjectStoreConfigError},
};

const CONSUMER_MODE_ENV: &str = "MOMO_OCR_V2_CONSUMER_MODE";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OcrConsumerMode {
    Disabled,
    Enabled,
}

pub(crate) enum OcrConsumerRuntimeConfig {
    Disabled,
    Enabled(Box<OcrConsumerConfig>),
}

impl OcrConsumerRuntimeConfig {
    pub(crate) fn from_environment(
        database_url: String,
        redis_url: String,
    ) -> Result<Self, OcrRuntimeConfigError> {
        Self::from_lookup(database_url, redis_url, |name| env::var(name).ok())
    }

    fn from_lookup<F>(
        database_url: String,
        redis_url: String,
        mut lookup: F,
    ) -> Result<Self, OcrRuntimeConfigError>
    where
        F: FnMut(&'static str) -> Option<String>,
    {
        match mode_from_lookup(&mut lookup)? {
            OcrConsumerMode::Disabled => Ok(Self::Disabled),
            OcrConsumerMode::Enabled => {
                let endpoint = required(&mut lookup, "SOURCE_IMAGE_R2_ENDPOINT")?;
                let bucket = required(&mut lookup, "SOURCE_IMAGE_R2_BUCKET")?;
                let object_store = R2ObjectStoreConfig::new(
                    &endpoint,
                    &bucket,
                    required(&mut lookup, "SOURCE_IMAGE_R2_ACCESS_KEY_ID")?,
                    required(&mut lookup, "SOURCE_IMAGE_R2_SECRET_ACCESS_KEY")?,
                    duration(&mut lookup, "MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS")?,
                    positive(&mut lookup, "MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS")?,
                )?;
                let config = OcrConsumerConfig::new(
                    database_url,
                    redis_url,
                    required(&mut lookup, "OCR_REDIS_V2_STREAM")?,
                    required(&mut lookup, "MOMO_OCR_V2_REDIS_GROUP")?,
                    required(&mut lookup, "OCR_REDIS_V2_DEAD_LETTER_STREAM")?,
                    required(&mut lookup, "MOMO_OCR_V2_WORKER_ID")?,
                    object_store,
                    duration(&mut lookup, "MOMO_OCR_V2_LEASE_DURATION_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_RETRY_DELAY_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_REDIS_BLOCK_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_CLAIM_IDLE_MS")?,
                    duration(&mut lookup, "MOMO_OCR_V2_TIMEOUT_MS")?,
                    positive_usize(&mut lookup, "MOMO_OCR_V2_MAXIMUM_DELIVERY_ATTEMPTS")?,
                    positive_usize(&mut lookup, "MOMO_OCR_V2_PENDING_SCAN_COUNT")?,
                )?;
                Ok(Self::Enabled(Box::new(config)))
            }
        }
    }
}

pub(crate) fn consumer_mode_from_environment() -> Result<OcrConsumerMode, OcrRuntimeConfigError> {
    mode_from_lookup(&mut |name| env::var(name).ok())
}

fn mode_from_lookup<F>(lookup: &mut F) -> Result<OcrConsumerMode, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    match lookup(CONSUMER_MODE_ENV).as_deref().unwrap_or("disabled") {
        "disabled" => Ok(OcrConsumerMode::Disabled),
        "enabled" => Ok(OcrConsumerMode::Enabled),
        _ => Err(OcrRuntimeConfigError::InvalidMode),
    }
}

fn required<F>(lookup: &mut F, name: &'static str) -> Result<String, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    lookup(name)
        .filter(|value| !value.trim().is_empty())
        .ok_or(OcrRuntimeConfigError::Missing { name })
}

fn positive<F>(lookup: &mut F, name: &'static str) -> Result<u32, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    required(lookup, name)?
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or(OcrRuntimeConfigError::InvalidPositiveInteger { name })
}

fn positive_u64<F>(lookup: &mut F, name: &'static str) -> Result<u64, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    required(lookup, name)?
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or(OcrRuntimeConfigError::InvalidPositiveInteger { name })
}

fn positive_usize<F>(lookup: &mut F, name: &'static str) -> Result<usize, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    positive_u64(lookup, name)?
        .try_into()
        .map_err(|_error| OcrRuntimeConfigError::InvalidPositiveInteger { name })
}

fn duration<F>(lookup: &mut F, name: &'static str) -> Result<Duration, OcrRuntimeConfigError>
where
    F: FnMut(&'static str) -> Option<String>,
{
    positive_u64(lookup, name).map(Duration::from_millis)
}

#[derive(Debug, Error)]
pub enum OcrRuntimeConfigError {
    #[error("{CONSUMER_MODE_ENV} must be disabled or enabled")]
    InvalidMode,
    #[error("{name} must be set when the Rust OCR v2 consumer is enabled")]
    Missing { name: &'static str },
    #[error("{name} must be a positive integer")]
    InvalidPositiveInteger { name: &'static str },
    #[error("Rust OCR v2 object-store configuration is unsafe")]
    ObjectStore(#[from] R2ObjectStoreConfigError),
    #[error("Rust OCR v2 worker configuration is unsafe")]
    Consumer(#[from] OcrConsumerError),
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[test]
    fn consumer_is_explicitly_disabled_without_r2_credentials() {
        let result = OcrConsumerRuntimeConfig::from_lookup(
            String::from("postgresql://localhost/test"),
            String::from("redis://localhost/"),
            |_name| None,
        );
        assert!(matches!(result, Ok(OcrConsumerRuntimeConfig::Disabled)));
    }

    #[test]
    fn enabled_consumer_requires_every_bounded_runtime_setting() {
        let mut values = complete_values();
        values.remove("SOURCE_IMAGE_R2_SECRET_ACCESS_KEY");
        let result = build(&values);
        assert!(matches!(
            result,
            Err(OcrRuntimeConfigError::Missing {
                name: "SOURCE_IMAGE_R2_SECRET_ACCESS_KEY"
            })
        ));

        let complete = build(&complete_values());
        assert!(matches!(complete, Ok(OcrConsumerRuntimeConfig::Enabled(_))));
    }

    #[test]
    fn enabled_consumer_rejects_implicit_or_unsafe_modes_and_timing() {
        let mut values = complete_values();
        values.insert(CONSUMER_MODE_ENV, "auto");
        assert!(matches!(
            build(&values),
            Err(OcrRuntimeConfigError::InvalidMode)
        ));

        values.insert(CONSUMER_MODE_ENV, "enabled");
        values.insert("MOMO_OCR_V2_CLAIM_IDLE_MS", "110000");
        assert!(matches!(
            build(&values),
            Err(OcrRuntimeConfigError::Consumer(
                OcrConsumerError::InvalidConfiguration
            ))
        ));
    }

    fn build(
        values: &BTreeMap<&'static str, &'static str>,
    ) -> Result<OcrConsumerRuntimeConfig, OcrRuntimeConfigError> {
        OcrConsumerRuntimeConfig::from_lookup(
            String::from("postgresql://localhost/test"),
            String::from("redis://localhost/"),
            |name| values.get(name).map(|value| String::from(*value)),
        )
    }

    fn complete_values() -> BTreeMap<&'static str, &'static str> {
        BTreeMap::from([
            (CONSUMER_MODE_ENV, "enabled"),
            ("SOURCE_IMAGE_R2_ENDPOINT", "http://127.0.0.1:9000"),
            ("SOURCE_IMAGE_R2_BUCKET", "ocr-test"),
            ("SOURCE_IMAGE_R2_ACCESS_KEY_ID", "access-key"),
            ("SOURCE_IMAGE_R2_SECRET_ACCESS_KEY", "secret-key"),
            ("MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS", "10000"),
            ("MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS", "5000"),
            ("MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS", "1"),
            ("OCR_REDIS_V2_STREAM", "momo:ocr:v2:jobs"),
            ("MOMO_OCR_V2_REDIS_GROUP", "momo-ocr-rust-v2"),
            ("OCR_REDIS_V2_DEAD_LETTER_STREAM", "momo:ocr:v2:jobs:dead"),
            ("MOMO_OCR_V2_WORKER_ID", "ocr-worker-1"),
            ("MOMO_OCR_V2_LEASE_DURATION_MS", "60000"),
            ("MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS", "5000"),
            ("MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS", "5000"),
            ("MOMO_OCR_V2_RETRY_DELAY_MS", "1000"),
            ("MOMO_OCR_V2_REDIS_BLOCK_MS", "1000"),
            ("MOMO_OCR_V2_CLAIM_IDLE_MS", "111000"),
            ("MOMO_OCR_V2_TIMEOUT_MS", "30000"),
            ("MOMO_OCR_V2_MAXIMUM_DELIVERY_ATTEMPTS", "2"),
            ("MOMO_OCR_V2_PENDING_SCAN_COUNT", "10"),
        ])
    }
}
