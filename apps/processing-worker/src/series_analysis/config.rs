use std::{
    env,
    num::NonZeroU64,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use thiserror::Error;

use crate::{
    cgroup::{CgroupError, ChildCgroup},
    pel_recovery::MAXIMUM_READ_BLOCK,
};

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
    pub(crate) heartbeat_timeout: Duration,
    pub(crate) child_stop_grace: Duration,
    pub(crate) redis_block: Duration,
    pub(crate) pel_recovery_interval: Duration,
    pub(crate) execution_limits: AnalysisExecutionLimits,
    pub(crate) child_cgroup: ChildCgroup,
    pub(crate) notifications: crate::notifications::NotificationSink,
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
    #[error("analysis Redis read block exceeds the shutdown wait bound")]
    UnsafeRedisBlock,
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
        Self::from_lookup(&|name| env::var(name).ok())
    }

    fn from_lookup(lookup: &impl Fn(&str) -> Option<String>) -> Result<Self, AnalysisConfigError> {
        let publication_mode = match lookup(PUBLICATION_MODE_ENV)
            .unwrap_or_else(|| String::from("disabled"))
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
            runtime_memory_limit: positive(lookup, "MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES")?,
            child_memory_limit: positive(lookup, CHILD_MEMORY_LIMIT_ENV)?,
            parent_headroom: positive(lookup, "MOMO_ANALYSIS_PARENT_HEADROOM_BYTES")?,
            calculation_timeout: duration_millis(lookup, "MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS")?,
            finalization_timeout: duration_millis(lookup, "MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS")?,
            temporary_bytes_limit: positive(lookup, "MOMO_ANALYSIS_TEMPORARY_MAX_BYTES")?,
            chunk_bytes_limit: positive(lookup, "MOMO_ANALYSIS_CHUNK_MAX_BYTES")?,
            chunk_count_limit: positive(lookup, "MOMO_ANALYSIS_CHUNK_COUNT_MAX")?,
            temporary_file_count_limit: positive(lookup, "MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX")?,
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
    /// One delayed renewal and one parent-liveness window must fit before finalization.
    pub(crate) fn renewal_window(&self) -> Duration {
        self.heartbeat_interval.max(self.heartbeat_timeout)
    }

    pub(crate) fn with_notifications(
        mut self,
        notifications: crate::notifications::NotificationSink,
    ) -> Self {
        self.notifications = notifications;
        self
    }

    /// Loads connection and lease settings only after publication safety limits are accepted.
    ///
    /// # Errors
    ///
    /// Returns an error without exposing connection strings when runtime configuration is absent
    /// or its timing relationship cannot stop a child before lease expiry.
    pub(crate) fn from_environment(
        activation: &AnalysisActivationConfig,
    ) -> Result<Self, AnalysisConfigError> {
        Self::from_lookup(
            activation,
            &|name| env::var(name).ok(),
            ChildCgroup::from_environment,
        )
    }

    fn from_lookup(
        activation: &AnalysisActivationConfig,
        lookup: &impl Fn(&str) -> Option<String>,
        open_cgroup: impl FnOnce(u64) -> Result<ChildCgroup, CgroupError>,
    ) -> Result<Self, AnalysisConfigError> {
        let execution_limits =
            activation
                .execution_limits
                .clone()
                .ok_or(AnalysisConfigError::MissingRuntime {
                    name: PUBLICATION_MODE_ENV,
                })?;
        let lease_duration = duration_millis(lookup, "MOMO_ANALYSIS_LEASE_DURATION_MS")?;
        let heartbeat_interval = duration_millis(lookup, "MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS")?;
        let heartbeat_timeout = duration_millis(lookup, "MOMO_ANALYSIS_HEARTBEAT_TIMEOUT_MS")?;
        let child_stop_grace = duration_millis(lookup, "MOMO_ANALYSIS_CHILD_STOP_GRACE_MS")?;
        let redis_block = duration_millis(lookup, "MOMO_ANALYSIS_REDIS_BLOCK_MS")?;
        let pel_recovery_interval =
            duration_millis(lookup, "MOMO_ANALYSIS_PEL_RECOVERY_INTERVAL_MS")?;
        let required_margin = heartbeat_interval
            .max(heartbeat_timeout)
            .checked_mul(3)
            .and_then(|value| value.checked_add(child_stop_grace))
            .and_then(|value| value.checked_add(execution_limits.finalization_timeout));
        if required_margin.is_none_or(|required| required >= lease_duration) {
            return Err(AnalysisConfigError::UnsafeLeaseRelationship);
        }
        if redis_block > MAXIMUM_READ_BLOCK {
            return Err(AnalysisConfigError::UnsafeRedisBlock);
        }
        let redis_stream = lookup("MOMO_REDIS_ANALYSIS_STREAM")
            .unwrap_or_else(|| String::from("momo:analysis:jobs"));
        let redis_group =
            lookup("MOMO_ANALYSIS_REDIS_GROUP").unwrap_or_else(|| String::from("momo-analysis-v1"));
        let worker_id = required_string(lookup, "MOMO_ANALYSIS_WORKER_ID")?;
        let effective_config_version = required_string(lookup, "MOMO_ANALYSIS_CONFIG_VERSION")?;
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
        let temporary_root =
            PathBuf::from(required_string(lookup, "MOMO_ANALYSIS_TEMPORARY_ROOT")?);
        if !dedicated_absolute_path(&temporary_root) {
            return Err(AnalysisConfigError::UnsafeTemporaryRoot);
        }
        let child_cgroup = open_cgroup(execution_limits.child_memory_limit.get())
            .map_err(|error| AnalysisConfigError::ChildCgroup { kind: error.kind() })?;
        Ok(Self {
            database_url: required_string(lookup, "DATABASE_URL")?,
            outbox_listener_database_url: required_string(
                lookup,
                OUTBOX_LISTENER_DATABASE_URL_ENV,
            )?,
            read_database_url: required_string(lookup, "MOMO_ANALYSIS_READ_DATABASE_URL")?,
            redis_url: required_string(lookup, "REDIS_URL")?,
            redis_stream,
            redis_group,
            worker_id,
            temporary_root,
            effective_config_version,
            lease_duration,
            heartbeat_interval,
            heartbeat_timeout,
            child_stop_grace,
            redis_block,
            pel_recovery_interval,
            execution_limits,
            child_cgroup,
            notifications: crate::notifications::NotificationSink::default(),
        })
    }
}

fn positive(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &'static str,
) -> Result<NonZeroU64, AnalysisConfigError> {
    let raw = lookup(name).ok_or(AnalysisConfigError::Missing { name })?;
    raw.parse::<u64>()
        .ok()
        .and_then(NonZeroU64::new)
        .ok_or(AnalysisConfigError::InvalidPositiveInteger { name })
}

fn duration_millis(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &'static str,
) -> Result<Duration, AnalysisConfigError> {
    positive(lookup, name).map(|value| Duration::from_millis(value.get()))
}

fn required_string(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &'static str,
) -> Result<String, AnalysisConfigError> {
    lookup(name)
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
    clippy::expect_used,
    reason = "configuration fixtures abort with precise context when test setup is invalid"
)]
mod tests;
