use std::{
    env,
    num::NonZeroU64,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use thiserror::Error;

const PUBLICATION_MODE_ENV: &str = "MOMO_ANALYSIS_PUBLICATION_MODE";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationMode {
    Disabled,
    Enabled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationLimits {
    pub runtime_memory_limit: NonZeroU64,
    pub child_memory_limit: NonZeroU64,
    pub parent_headroom: NonZeroU64,
    pub calculation_timeout: Duration,
    pub finalization_timeout: Duration,
    pub temporary_bytes_limit: NonZeroU64,
    pub chunk_bytes_limit: NonZeroU64,
    pub chunk_count_limit: NonZeroU64,
    pub temporary_file_count_limit: NonZeroU64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkerConfig {
    pub publication_mode: PublicationMode,
    pub limits: Option<PublicationLimits>,
}

#[derive(Clone)]
pub struct WorkerRuntimeConfig {
    pub database_url: String,
    pub read_database_url: String,
    pub redis_url: String,
    pub redis_stream: String,
    pub redis_group: String,
    pub worker_id: String,
    pub temporary_root: PathBuf,
    pub effective_config_version: String,
    pub lease_duration: Duration,
    pub heartbeat_interval: Duration,
    pub shutdown_grace: Duration,
    pub redis_block: Duration,
    pub publication_limits: PublicationLimits,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ConfigError {
    #[error("{name} must be set when analysis publication is enabled")]
    Missing { name: &'static str },
    #[error("{name} must be a positive integer")]
    InvalidPositiveInteger { name: &'static str },
    #[error("{PUBLICATION_MODE_ENV} must be disabled or enabled")]
    InvalidPublicationMode,
    #[error("child memory limit plus parent headroom must not exceed the runtime memory limit")]
    UnsafeMemoryRelationship,
    #[error("temporary file limit must allow every chunk plus the manifest")]
    UnsafeFileRelationship,
    #[error("{name} must be set when the analysis worker is enabled")]
    MissingRuntime { name: &'static str },
    #[error("analysis worker lease, heartbeat, and shutdown intervals are unsafe")]
    UnsafeLeaseRelationship,
    #[error("{name} contains an unsafe runtime identifier")]
    UnsafeRuntimeIdentifier { name: &'static str },
    #[error("analysis temporary root must be a dedicated absolute path")]
    UnsafeTemporaryRoot,
}

impl WorkerConfig {
    /// Loads the publication mode and its mandatory safety limits.
    ///
    /// # Errors
    ///
    /// Returns an error when publication is enabled with missing, invalid, or unsafe limits.
    pub fn from_environment() -> Result<Self, ConfigError> {
        let publication_mode = match env::var(PUBLICATION_MODE_ENV)
            .unwrap_or_else(|_| String::from("disabled"))
            .trim()
        {
            "disabled" => PublicationMode::Disabled,
            "enabled" => PublicationMode::Enabled,
            _ => return Err(ConfigError::InvalidPublicationMode),
        };

        if publication_mode == PublicationMode::Disabled {
            return Ok(Self {
                publication_mode,
                limits: None,
            });
        }

        let limits = PublicationLimits {
            runtime_memory_limit: positive("MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES")?,
            child_memory_limit: positive("MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES")?,
            parent_headroom: positive("MOMO_ANALYSIS_PARENT_HEADROOM_BYTES")?,
            calculation_timeout: duration_millis("MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS")?,
            finalization_timeout: duration_millis("MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS")?,
            temporary_bytes_limit: positive("MOMO_ANALYSIS_TEMPORARY_MAX_BYTES")?,
            chunk_bytes_limit: positive("MOMO_ANALYSIS_CHUNK_MAX_BYTES")?,
            chunk_count_limit: positive("MOMO_ANALYSIS_CHUNK_COUNT_MAX")?,
            temporary_file_count_limit: positive("MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX")?,
        };
        if limits
            .child_memory_limit
            .get()
            .checked_add(limits.parent_headroom.get())
            .is_none_or(|required| required > limits.runtime_memory_limit.get())
        {
            return Err(ConfigError::UnsafeMemoryRelationship);
        }
        if limits
            .chunk_count_limit
            .get()
            .checked_add(1)
            .is_none_or(|required| required > limits.temporary_file_count_limit.get())
        {
            return Err(ConfigError::UnsafeFileRelationship);
        }

        Ok(Self {
            publication_mode,
            limits: Some(limits),
        })
    }
}

impl WorkerRuntimeConfig {
    /// Loads connection and lease settings only after publication safety limits are accepted.
    ///
    /// # Errors
    ///
    /// Returns an error without exposing connection strings when runtime configuration is absent
    /// or its timing relationship cannot stop a child before lease expiry.
    pub fn from_environment(worker: &WorkerConfig) -> Result<Self, ConfigError> {
        let publication_limits = worker.limits.clone().ok_or(ConfigError::MissingRuntime {
            name: PUBLICATION_MODE_ENV,
        })?;
        let lease_duration = duration_millis("MOMO_ANALYSIS_LEASE_DURATION_MS")?;
        let heartbeat_interval = duration_millis("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS")?;
        let shutdown_grace = duration_millis("MOMO_ANALYSIS_CHILD_STOP_GRACE_MS")?;
        let redis_block = duration_millis("MOMO_ANALYSIS_REDIS_BLOCK_MS")?;
        let required_margin = heartbeat_interval
            .checked_mul(3)
            .and_then(|value| value.checked_add(shutdown_grace));
        if required_margin.is_none_or(|required| required >= lease_duration) {
            return Err(ConfigError::UnsafeLeaseRelationship);
        }
        if heartbeat_interval
            .checked_add(publication_limits.finalization_timeout)
            .is_none_or(|required| required >= lease_duration)
            || redis_block > heartbeat_interval
        {
            return Err(ConfigError::UnsafeLeaseRelationship);
        }
        let redis_stream = env::var("MOMO_REDIS_ANALYSIS_STREAM")
            .unwrap_or_else(|_| String::from("momo:analysis:jobs"));
        let redis_group = env::var("MOMO_ANALYSIS_REDIS_GROUP")
            .unwrap_or_else(|_| String::from("momo-analysis-v1"));
        let worker_id = required_string("MOMO_ANALYSIS_WORKER_ID")?;
        let effective_config_version = required_string("MOMO_ANALYSIS_CONFIG_VERSION")?;
        for (name, value) in [
            ("MOMO_REDIS_ANALYSIS_STREAM", redis_stream.as_str()),
            ("MOMO_ANALYSIS_REDIS_GROUP", redis_group.as_str()),
            ("MOMO_ANALYSIS_WORKER_ID", worker_id.as_str()),
            (
                "MOMO_ANALYSIS_CONFIG_VERSION",
                effective_config_version.as_str(),
            ),
        ] {
            if !valid_runtime_identifier(value) {
                return Err(ConfigError::UnsafeRuntimeIdentifier { name });
            }
        }
        let temporary_root = PathBuf::from(required_string("MOMO_ANALYSIS_TEMPORARY_ROOT")?);
        if !dedicated_absolute_path(&temporary_root) {
            return Err(ConfigError::UnsafeTemporaryRoot);
        }
        Ok(Self {
            database_url: required_string("DATABASE_URL")?,
            read_database_url: required_string("MOMO_ANALYSIS_READ_DATABASE_URL")?,
            redis_url: required_string("REDIS_URL")?,
            redis_stream,
            redis_group,
            worker_id,
            temporary_root,
            effective_config_version,
            lease_duration,
            heartbeat_interval,
            shutdown_grace,
            redis_block,
            publication_limits,
        })
    }
}

fn positive(name: &'static str) -> Result<NonZeroU64, ConfigError> {
    let raw = env::var(name).map_err(|_environment_error| ConfigError::Missing { name })?;
    raw.parse::<u64>()
        .ok()
        .and_then(NonZeroU64::new)
        .ok_or(ConfigError::InvalidPositiveInteger { name })
}

fn duration_millis(name: &'static str) -> Result<Duration, ConfigError> {
    positive(name).map(|value| Duration::from_millis(value.get()))
}

fn required_string(name: &'static str) -> Result<String, ConfigError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError::MissingRuntime { name })
}

fn valid_runtime_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

fn dedicated_absolute_path(path: &Path) -> bool {
    path.is_absolute()
        && path != Path::new("/")
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
}

#[cfg(test)]
#[expect(
    unsafe_code,
    reason = "Rust 2024 environment mutation is unsafe; tests serialize it with a global mutex"
)]
#[expect(
    clippy::panic,
    reason = "configuration fixtures abort with context when a supposedly valid setup is rejected"
)]
mod tests;
