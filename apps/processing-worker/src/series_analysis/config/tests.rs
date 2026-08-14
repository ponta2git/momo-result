use std::{ffi::OsString, sync::Mutex};

use super::*;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const ENVIRONMENT_NAMES: [&str; 25] = [
    PUBLICATION_MODE_ENV,
    "MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES",
    "MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES",
    "MOMO_ANALYSIS_PARENT_HEADROOM_BYTES",
    "MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS",
    "MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS",
    "MOMO_ANALYSIS_TEMPORARY_MAX_BYTES",
    "MOMO_ANALYSIS_CHUNK_MAX_BYTES",
    "MOMO_ANALYSIS_CHUNK_COUNT_MAX",
    "MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX",
    "DATABASE_URL",
    "MOMO_ANALYSIS_READ_DATABASE_URL",
    "REDIS_URL",
    "MOMO_REDIS_ANALYSIS_STREAM",
    "MOMO_ANALYSIS_REDIS_GROUP",
    "MOMO_ANALYSIS_WORKER_ID",
    "MOMO_ANALYSIS_TEMPORARY_ROOT",
    "MOMO_ANALYSIS_CONFIG_VERSION",
    "MOMO_ANALYSIS_LEASE_DURATION_MS",
    "MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS",
    "MOMO_ANALYSIS_CHILD_STOP_GRACE_MS",
    "MOMO_ANALYSIS_REDIS_BLOCK_MS",
    crate::cgroup::CGROUP_HIERARCHY_ENV,
    crate::cgroup::CGROUP_DIRECTORY_ENV,
    crate::cgroup::CGROUP_LIMIT_ENV,
];

struct EnvironmentGuard(Vec<(&'static str, Option<OsString>)>);

impl EnvironmentGuard {
    fn capture() -> Self {
        Self(
            ENVIRONMENT_NAMES
                .into_iter()
                .map(|name| (name, env::var_os(name)))
                .collect(),
        )
    }

    fn set(name: &'static str, value: &str) {
        // SAFETY: tests serialize all environment mutation with ENV_LOCK.
        unsafe { env::set_var(name, value) };
    }

    fn remove(name: &'static str) {
        // SAFETY: tests serialize all environment mutation with ENV_LOCK.
        unsafe { env::remove_var(name) };
    }
}

impl Drop for EnvironmentGuard {
    fn drop(&mut self) {
        for (name, value) in &self.0 {
            match value {
                Some(value) => {
                    // SAFETY: tests serialize all environment mutation with ENV_LOCK.
                    unsafe { env::set_var(name, value) };
                }
                None => {
                    // SAFETY: tests serialize all environment mutation with ENV_LOCK.
                    unsafe { env::remove_var(name) };
                }
            }
        }
    }
}

fn clear() {
    for name in ENVIRONMENT_NAMES {
        EnvironmentGuard::remove(name);
    }
}

fn valid_enabled_environment() {
    EnvironmentGuard::set(PUBLICATION_MODE_ENV, "enabled");
    EnvironmentGuard::set("MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES", "268435456");
    EnvironmentGuard::set("MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES", "134217728");
    EnvironmentGuard::set("MOMO_ANALYSIS_PARENT_HEADROOM_BYTES", "134217728");
    EnvironmentGuard::set("MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS", "60000");
    EnvironmentGuard::set("MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS", "10000");
    EnvironmentGuard::set("MOMO_ANALYSIS_TEMPORARY_MAX_BYTES", "67108864");
    EnvironmentGuard::set("MOMO_ANALYSIS_CHUNK_MAX_BYTES", "8388608");
    EnvironmentGuard::set("MOMO_ANALYSIS_CHUNK_COUNT_MAX", "10000");
    EnvironmentGuard::set("MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX", "10001");
}

fn valid_runtime_environment() -> tempfile::TempDir {
    EnvironmentGuard::set("DATABASE_URL", "postgresql://control.invalid/momo");
    EnvironmentGuard::set(
        "MOMO_ANALYSIS_READ_DATABASE_URL",
        "postgresql://reader.invalid/momo",
    );
    EnvironmentGuard::set("REDIS_URL", "redis://queue.invalid/");
    EnvironmentGuard::set("MOMO_REDIS_ANALYSIS_STREAM", "momo:analysis:jobs");
    EnvironmentGuard::set("MOMO_ANALYSIS_REDIS_GROUP", "momo-analysis-v1");
    EnvironmentGuard::set("MOMO_ANALYSIS_WORKER_ID", "worker-1");
    EnvironmentGuard::set("MOMO_ANALYSIS_TEMPORARY_ROOT", "/var/lib/momo-analysis");
    EnvironmentGuard::set("MOMO_ANALYSIS_CONFIG_VERSION", "config-v1");
    EnvironmentGuard::set("MOMO_ANALYSIS_LEASE_DURATION_MS", "60000");
    EnvironmentGuard::set("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS", "5000");
    EnvironmentGuard::set("MOMO_ANALYSIS_CHILD_STOP_GRACE_MS", "5000");
    EnvironmentGuard::set("MOMO_ANALYSIS_REDIS_BLOCK_MS", "5000");
    let cgroup_root = tempfile::tempdir().expect("temporary cgroup root must be created");
    let cgroup = cgroup_root
        .path()
        .join(crate::cgroup::CGROUP_DIRECTORY_NAME);
    std::fs::create_dir(&cgroup).expect("fixture cgroup must be created");
    std::fs::write(cgroup.join("cgroup.procs"), "")
        .expect("fixture cgroup membership must be written");
    std::fs::write(cgroup.join("memory.limit_in_bytes"), "134217728\n")
        .expect("fixture cgroup limit must be written");
    std::fs::write(cgroup.join("memory.usage_in_bytes"), "0\n")
        .expect("fixture cgroup usage must be written");
    std::fs::write(cgroup.join("memory.max_usage_in_bytes"), "0\n")
        .expect("fixture cgroup peak must be written");
    std::fs::write(cgroup.join("memory.failcnt"), "0\n")
        .expect("fixture cgroup limit-hit counter must be written");
    std::fs::write(cgroup.join("memory.oom_control"), "oom_kill 0\n")
        .expect("fixture cgroup events must be written");
    EnvironmentGuard::set(crate::cgroup::CGROUP_HIERARCHY_ENV, "v1");
    EnvironmentGuard::set(
        crate::cgroup::CGROUP_DIRECTORY_ENV,
        cgroup
            .to_str()
            .expect("temporary cgroup path must be UTF-8"),
    );
    EnvironmentGuard::set(crate::cgroup::CGROUP_LIMIT_ENV, "134217728");
    cgroup_root
}

#[test]
fn publication_is_disabled_without_limit_configuration() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _guard = EnvironmentGuard::capture();
    clear();

    let config = AnalysisActivationConfig::from_environment();

    assert_eq!(
        config,
        Ok(AnalysisActivationConfig {
            publication_mode: AnalysisPublicationMode::Disabled,
            execution_limits: None,
        })
    );
}

#[test]
fn publication_fails_closed_when_a_limit_is_missing() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _guard = EnvironmentGuard::capture();
    clear();
    EnvironmentGuard::set(PUBLICATION_MODE_ENV, "enabled");

    let config = AnalysisActivationConfig::from_environment();

    assert_eq!(
        config,
        Err(AnalysisConfigError::Missing {
            name: "MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES"
        })
    );
}

#[test]
fn publication_rejects_an_unsafe_memory_relationship() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _guard = EnvironmentGuard::capture();
    clear();
    valid_enabled_environment();
    EnvironmentGuard::set("MOMO_ANALYSIS_PARENT_HEADROOM_BYTES", "134217729");

    let config = AnalysisActivationConfig::from_environment();

    assert_eq!(config, Err(AnalysisConfigError::UnsafeMemoryRelationship));
}

#[test]
fn publication_accepts_a_complete_bounded_configuration() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _guard = EnvironmentGuard::capture();
    clear();
    valid_enabled_environment();

    let config = AnalysisActivationConfig::from_environment();

    assert!(matches!(
        config,
        Ok(AnalysisActivationConfig {
            publication_mode: AnalysisPublicationMode::Enabled,
            execution_limits: Some(_),
        })
    ));
}

#[test]
fn runtime_identifiers_and_temporary_roots_are_structurally_bounded() {
    assert!(valid_runtime_identifier("momo:analysis:jobs"));
    assert!(!valid_runtime_identifier(" analysis jobs"));
    assert!(dedicated_absolute_path(Path::new("/var/lib/momo-analysis")));
    assert!(!dedicated_absolute_path(Path::new("/")));
    assert!(!dedicated_absolute_path(Path::new(
        "/var/lib/../momo-analysis"
    )));
    assert!(!dedicated_absolute_path(Path::new(
        "relative/momo-analysis"
    )));
}

#[test]
fn runtime_accepts_only_timing_that_preserves_lease_recovery_margin() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _guard = EnvironmentGuard::capture();
    clear();
    valid_enabled_environment();
    let _cgroup = valid_runtime_environment();
    let initial_activation = AnalysisActivationConfig::from_environment()
        .unwrap_or_else(|error| panic!("valid analysis execution limits: {error}"));

    assert!(AnalysisConsumerConfig::from_environment(&initial_activation).is_ok());

    EnvironmentGuard::set("MOMO_ANALYSIS_REDIS_BLOCK_MS", "5001");
    assert!(matches!(
        AnalysisConsumerConfig::from_environment(&initial_activation),
        Err(AnalysisConfigError::UnsafeLeaseRelationship)
    ));

    EnvironmentGuard::set("MOMO_ANALYSIS_REDIS_BLOCK_MS", "5000");
    EnvironmentGuard::set("MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS", "56000");
    let activation_with_long_finalization = AnalysisActivationConfig::from_environment()
        .unwrap_or_else(|error| panic!("valid analysis memory limits: {error}"));
    assert!(matches!(
        AnalysisConsumerConfig::from_environment(&activation_with_long_finalization),
        Err(AnalysisConfigError::UnsafeLeaseRelationship)
    ));
}
