use std::{
    env,
    num::NonZeroU64,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use thiserror::Error;

use crate::cgroup::ChildCgroup;

const PUBLICATION_MODE_ENV: &str = "MOMO_ANALYSIS_PUBLICATION_MODE";
const OUTBOX_LISTENER_DATABASE_URL_ENV: &str = "MOMO_ANALYSIS_OUTBOX_LISTENER_DATABASE_URL";
pub(crate) const CHILD_MEMORY_LIMIT_ENV: &str = "MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AnalysisPublicationMode {
    Disabled,
    Enabled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AnalysisExecutionLimits {
    pub(crate) runtime_memory_limit: NonZeroU64,
    pub(crate) child_memory_limit: NonZeroU64,
    pub(crate) parent_headroom: NonZeroU64,
    pub(crate) calculation_timeout: Duration,
    pub(crate) finalization_timeout: Duration,
    pub(crate) temporary_bytes_limit: NonZeroU64,
    pub(crate) chunk_bytes_limit: NonZeroU64,
    pub(crate) chunk_count_limit: NonZeroU64,
    pub(crate) temporary_file_count_limit: NonZeroU64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AnalysisActivationConfig {
    pub(crate) publication_mode: AnalysisPublicationMode,
    pub(crate) execution_limits: Option<AnalysisExecutionLimits>,
}

#[derive(Clone)]
pub(crate) struct AnalysisConsumerConfig {
    pub(crate) database_url: String,
    pub(crate) outbox_listener_database_url: String,
    pub(crate) read_database_url: String,
    pub(crate) redis_url: String,
    pub(crate) redis_stream: String,
    pub(crate) redis_group: String,
    pub(crate) worker_id: String,
    pub(crate) temporary_root: PathBuf,
    pub(crate) effective_config_version: String,
    pub(crate) lease_duration: Duration,
    pub(crate) heartbeat_interval: Duration,
    pub(crate) child_stop_grace: Duration,
    pub(crate) redis_block: Duration,
    pub(crate) pel_recovery_interval: Duration,
    pub(crate) execution_limits: AnalysisExecutionLimits,
    pub(crate) child_cgroup: ChildCgroup,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub(crate) enum AnalysisConfigError {
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
    #[error("analysis child cgroup is unavailable: {kind}")]
    ChildCgroup { kind: &'static str },
}

impl AnalysisActivationConfig {
    /// Loads the publication mode and its mandatory safety limits.
    ///
    /// # Errors
    ///
    /// Returns an error when publication is enabled with missing, invalid, or unsafe limits.
    pub(crate) fn from_environment() -> Result<Self, AnalysisConfigError> {
        let publication_mode = match env::var(PUBLICATION_MODE_ENV)
            .unwrap_or_else(|_| String::from("disabled"))
            .trim()
        {
            "disabled" => AnalysisPublicationMode::Disabled,
            "enabled" => AnalysisPublicationMode::Enabled,
            _ => return Err(AnalysisConfigError::InvalidPublicationMode),
        };

        if publication_mode == AnalysisPublicationMode::Disabled {
            return Ok(Self {
                publication_mode,
                execution_limits: None,
            });
        }

        let execution_limits = AnalysisExecutionLimits {
            runtime_memory_limit: positive("MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES")?,
            child_memory_limit: positive(CHILD_MEMORY_LIMIT_ENV)?,
            parent_headroom: positive("MOMO_ANALYSIS_PARENT_HEADROOM_BYTES")?,
            calculation_timeout: duration_millis("MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS")?,
            finalization_timeout: duration_millis("MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS")?,
            temporary_bytes_limit: positive("MOMO_ANALYSIS_TEMPORARY_MAX_BYTES")?,
            chunk_bytes_limit: positive("MOMO_ANALYSIS_CHUNK_MAX_BYTES")?,
            chunk_count_limit: positive("MOMO_ANALYSIS_CHUNK_COUNT_MAX")?,
            temporary_file_count_limit: positive("MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX")?,
        };
        if execution_limits
            .child_memory_limit
            .get()
            .checked_add(execution_limits.parent_headroom.get())
            .is_none_or(|required| required > execution_limits.runtime_memory_limit.get())
        {
            return Err(AnalysisConfigError::UnsafeMemoryRelationship);
        }
        if execution_limits
            .chunk_count_limit
            .get()
            .checked_add(1)
            .is_none_or(|required| required > execution_limits.temporary_file_count_limit.get())
        {
            return Err(AnalysisConfigError::UnsafeFileRelationship);
        }

        Ok(Self {
            publication_mode,
            execution_limits: Some(execution_limits),
        })
    }
}

impl AnalysisConsumerConfig {
    /// Loads connection and lease settings only after publication safety limits are accepted.
    ///
    /// # Errors
    ///
    /// Returns an error without exposing connection strings when runtime configuration is absent
    /// or its timing relationship cannot stop a child before lease expiry.
    pub(crate) fn from_environment(
        activation: &AnalysisActivationConfig,
    ) -> Result<Self, AnalysisConfigError> {
        let execution_limits =
            activation
                .execution_limits
                .clone()
                .ok_or(AnalysisConfigError::MissingRuntime {
                    name: PUBLICATION_MODE_ENV,
                })?;
        let lease_duration = duration_millis("MOMO_ANALYSIS_LEASE_DURATION_MS")?;
        let heartbeat_interval = duration_millis("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS")?;
        let child_stop_grace = duration_millis("MOMO_ANALYSIS_CHILD_STOP_GRACE_MS")?;
        let redis_block = duration_millis("MOMO_ANALYSIS_REDIS_BLOCK_MS")?;
        let pel_recovery_interval = duration_millis("MOMO_ANALYSIS_PEL_RECOVERY_INTERVAL_MS")?;
        let required_margin = heartbeat_interval
            .checked_mul(3)
            .and_then(|value| value.checked_add(child_stop_grace))
            .and_then(|value| value.checked_add(execution_limits.finalization_timeout));
        if required_margin.is_none_or(|required| required >= lease_duration) {
            return Err(AnalysisConfigError::UnsafeLeaseRelationship);
        }
        if redis_block > heartbeat_interval {
            return Err(AnalysisConfigError::UnsafeLeaseRelationship);
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
            if !crate::runtime_identifier::valid(value) {
                return Err(AnalysisConfigError::UnsafeRuntimeIdentifier { name });
            }
        }
        let temporary_root = PathBuf::from(required_string("MOMO_ANALYSIS_TEMPORARY_ROOT")?);
        if !dedicated_absolute_path(&temporary_root) {
            return Err(AnalysisConfigError::UnsafeTemporaryRoot);
        }
        let child_cgroup = ChildCgroup::from_environment(execution_limits.child_memory_limit.get())
            .map_err(|error| AnalysisConfigError::ChildCgroup { kind: error.kind() })?;
        Ok(Self {
            database_url: required_string("DATABASE_URL")?,
            outbox_listener_database_url: required_string(OUTBOX_LISTENER_DATABASE_URL_ENV)?,
            read_database_url: required_string("MOMO_ANALYSIS_READ_DATABASE_URL")?,
            redis_url: required_string("REDIS_URL")?,
            redis_stream,
            redis_group,
            worker_id,
            temporary_root,
            effective_config_version,
            lease_duration,
            heartbeat_interval,
            child_stop_grace,
            redis_block,
            pel_recovery_interval,
            execution_limits,
            child_cgroup,
        })
    }
}

fn positive(name: &'static str) -> Result<NonZeroU64, AnalysisConfigError> {
    let raw = env::var(name).map_err(|_environment_error| AnalysisConfigError::Missing { name })?;
    raw.parse::<u64>()
        .ok()
        .and_then(NonZeroU64::new)
        .ok_or(AnalysisConfigError::InvalidPositiveInteger { name })
}

fn duration_millis(name: &'static str) -> Result<Duration, AnalysisConfigError> {
    positive(name).map(|value| Duration::from_millis(value.get()))
}

fn required_string(name: &'static str) -> Result<String, AnalysisConfigError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(AnalysisConfigError::MissingRuntime { name })
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
#[expect(
    clippy::expect_used,
    reason = "configuration fixtures abort with precise context when test setup is invalid"
)]
mod tests;
