use std::collections::BTreeMap;

use super::*;
use crate::cgroup::{CGROUP_DIRECTORY_NAME, CgroupHierarchy};

type Environment = BTreeMap<&'static str, String>;

fn enabled_environment() -> Environment {
    [
        (PUBLICATION_MODE_ENV, "enabled"),
        ("MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES", "268435456"),
        (CHILD_MEMORY_LIMIT_ENV, "134217728"),
        ("MOMO_ANALYSIS_PARENT_HEADROOM_BYTES", "134217728"),
        ("MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS", "60000"),
        ("MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS", "10000"),
        ("MOMO_ANALYSIS_TEMPORARY_MAX_BYTES", "67108864"),
        ("MOMO_ANALYSIS_CHUNK_MAX_BYTES", "8388608"),
        ("MOMO_ANALYSIS_CHUNK_COUNT_MAX", "10000"),
        ("MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX", "10001"),
    ]
    .into_iter()
    .map(|(name, value)| (name, String::from(value)))
    .collect()
}

fn activation(environment: &Environment) -> Result<AnalysisActivationConfig, AnalysisConfigError> {
    AnalysisActivationConfig::from_lookup(&|name| environment.get(name).cloned())
}

fn runtime_environment() -> Environment {
    let mut environment = enabled_environment();
    environment.extend(
        [
            ("DATABASE_URL", "postgresql://control.invalid/momo"),
            (
                OUTBOX_LISTENER_DATABASE_URL_ENV,
                "postgresql://listener.invalid/momo",
            ),
            (
                "MOMO_ANALYSIS_READ_DATABASE_URL",
                "postgresql://reader.invalid/momo",
            ),
            ("REDIS_URL", "redis://queue.invalid/"),
            ("MOMO_ANALYSIS_WORKER_ID", "worker-1"),
            ("MOMO_ANALYSIS_TEMPORARY_ROOT", "/var/lib/momo-analysis"),
            ("MOMO_ANALYSIS_CONFIG_VERSION", "config-v1"),
            ("MOMO_ANALYSIS_LEASE_DURATION_MS", "60000"),
            ("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS", "5000"),
            ("MOMO_ANALYSIS_HEARTBEAT_TIMEOUT_MS", "5000"),
            ("MOMO_ANALYSIS_CHILD_STOP_GRACE_MS", "5000"),
            ("MOMO_ANALYSIS_REDIS_BLOCK_MS", "5000"),
            ("MOMO_ANALYSIS_PEL_RECOVERY_INTERVAL_MS", "300000"),
        ]
        .into_iter()
        .map(|(name, value)| (name, String::from(value))),
    );
    environment
}

fn cgroup_fixture() -> tempfile::TempDir {
    let temporary = tempfile::tempdir().expect("temporary cgroup root");
    let directory = temporary.path().join(CGROUP_DIRECTORY_NAME);
    std::fs::create_dir(&directory).expect("fixture cgroup directory");
    for (name, value) in [
        ("cgroup.procs", ""),
        ("memory.limit_in_bytes", "134217728\n"),
        ("memory.usage_in_bytes", "0\n"),
        ("memory.max_usage_in_bytes", "0\n"),
        ("memory.failcnt", "0\n"),
        ("memory.oom_control", "oom_kill 0\n"),
    ] {
        std::fs::write(directory.join(name), value).expect("fixture cgroup controller");
    }
    temporary
}

fn runtime(
    environment: &Environment,
    cgroup_root: &Path,
) -> Result<AnalysisConsumerConfig, AnalysisConfigError> {
    AnalysisConsumerConfig::from_lookup(
        &activation(environment)?,
        &|name| environment.get(name).cloned(),
        |expected_limit| {
            ChildCgroup::open_fixture(
                CgroupHierarchy::V1,
                cgroup_root.join(CGROUP_DIRECTORY_NAME),
                expected_limit,
            )
        },
    )
}

#[test]
fn runtime_requires_and_preserves_the_dedicated_outbox_listener_url() {
    let mut environment = runtime_environment();
    let cgroup = cgroup_fixture();
    environment.remove(OUTBOX_LISTENER_DATABASE_URL_ENV);
    assert_eq!(
        runtime(&environment, cgroup.path()).err(),
        Some(AnalysisConfigError::MissingRuntime {
            name: OUTBOX_LISTENER_DATABASE_URL_ENV,
        })
    );

    environment.insert(
        OUTBOX_LISTENER_DATABASE_URL_ENV,
        String::from("postgresql://listener.invalid/momo"),
    );
    let config = runtime(&environment, cgroup.path()).expect("complete runtime configuration");
    assert_eq!(config.database_url, "postgresql://control.invalid/momo");
    assert_eq!(
        config.outbox_listener_database_url,
        "postgresql://listener.invalid/momo"
    );
    assert_eq!(config.read_database_url, "postgresql://reader.invalid/momo");
    assert_eq!(config.redis_stream, "momo:analysis:jobs");
    assert_eq!(config.redis_group, "momo-analysis-v1");
}

#[test]
fn publication_is_disabled_without_limit_configuration_and_rejects_unknown_modes() {
    assert_eq!(
        activation(&Environment::new()),
        Ok(AnalysisActivationConfig {
            publication_mode: AnalysisPublicationMode::Disabled,
            execution_limits: None,
        })
    );
    let mut environment = enabled_environment();
    environment.insert(PUBLICATION_MODE_ENV, String::from("unknown"));
    assert_eq!(
        activation(&environment),
        Err(AnalysisConfigError::InvalidPublicationMode)
    );
}

#[test]
fn publication_requires_positive_limits() {
    let mut environment = enabled_environment();
    let name = "MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES";
    environment.remove(name);
    assert_eq!(
        activation(&environment),
        Err(AnalysisConfigError::Missing { name })
    );
    for invalid in ["0", "18446744073709551616", "-1"] {
        environment.insert(name, String::from(invalid));
        assert_eq!(
            activation(&environment),
            Err(AnalysisConfigError::InvalidPositiveInteger { name }),
            "invalid limit {invalid} must fail closed",
        );
    }
}

#[test]
fn publication_bounds_memory_and_manifest_space_without_overflow() {
    let environment = enabled_environment();
    let config = activation(&environment).expect("complete bounded configuration");
    let limits = config.execution_limits.expect("enabled execution limits");
    assert_eq!(config.publication_mode, AnalysisPublicationMode::Enabled);
    assert_eq!(limits.runtime_memory_limit.get(), 268_435_456);
    assert_eq!(
        limits.child_memory_limit.get() + limits.parent_headroom.get(),
        268_435_456
    );
    assert_eq!(limits.calculation_timeout, Duration::from_secs(60));
    assert_eq!(limits.finalization_timeout, Duration::from_secs(10));
    assert_eq!(
        limits.temporary_file_count_limit.get(),
        limits.chunk_count_limit.get() + 1
    );

    for (name, value, expected) in [
        (
            "MOMO_ANALYSIS_PARENT_HEADROOM_BYTES",
            "134217729",
            AnalysisConfigError::UnsafeMemoryRelationship,
        ),
        (
            "MOMO_ANALYSIS_PARENT_HEADROOM_BYTES",
            "18446744073709551615",
            AnalysisConfigError::UnsafeMemoryRelationship,
        ),
        (
            "MOMO_ANALYSIS_TEMPORARY_FILE_COUNT_MAX",
            "10000",
            AnalysisConfigError::UnsafeFileRelationship,
        ),
        (
            "MOMO_ANALYSIS_CHUNK_COUNT_MAX",
            "18446744073709551615",
            AnalysisConfigError::UnsafeFileRelationship,
        ),
    ] {
        let mut invalid = environment.clone();
        invalid.insert(name, String::from(value));
        assert_eq!(activation(&invalid), Err(expected), "unsafe limit {name}");
    }
}

#[test]
fn temporary_root_must_be_a_dedicated_absolute_path() {
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
fn renewal_deadline_is_required_and_independent_of_cadence() {
    let mut environment = runtime_environment();
    let cgroup = cgroup_fixture();
    environment.insert("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS", String::from("1000"));
    environment.insert("MOMO_ANALYSIS_CHILD_STOP_GRACE_MS", String::from("1000"));
    environment.insert(
        "MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS",
        String::from("45000"),
    );
    for lease in ["60000", "61000"] {
        environment.insert("MOMO_ANALYSIS_LEASE_DURATION_MS", String::from(lease));
        assert_eq!(
            runtime(&environment, cgroup.path()).err(),
            Some(AnalysisConfigError::UnsafeLeaseRelationship),
            "lease must exceed the full renewal/liveness/finalization budget",
        );
    }
    environment.insert("MOMO_ANALYSIS_LEASE_DURATION_MS", String::from("70000"));
    for cadence in ["1000", "5000"] {
        environment.insert("MOMO_ANALYSIS_HEARTBEAT_INTERVAL_MS", String::from(cadence));
        let config = runtime(&environment, cgroup.path()).expect("safe lease");
        assert_eq!(config.heartbeat_timeout, Duration::from_secs(5));
        assert_eq!(config.renewal_window(), Duration::from_secs(5));
    }
    let name = "MOMO_ANALYSIS_HEARTBEAT_TIMEOUT_MS";
    environment.insert(name, String::from("18446744073709551615"));
    assert_eq!(
        runtime(&environment, cgroup.path()).err(),
        Some(AnalysisConfigError::UnsafeLeaseRelationship)
    );
    environment.remove(name);
    assert_eq!(
        runtime(&environment, cgroup.path()).err(),
        Some(AnalysisConfigError::Missing { name })
    );
}

#[test]
fn runtime_accepts_only_timing_that_preserves_lease_recovery_margin() {
    let environment = runtime_environment();
    let cgroup = cgroup_fixture();
    for (name, value, expected) in [
        ("MOMO_ANALYSIS_LEASE_DURATION_MS", "31000", None),
        (
            "MOMO_ANALYSIS_LEASE_DURATION_MS",
            "30000",
            Some(AnalysisConfigError::UnsafeLeaseRelationship),
        ),
        ("MOMO_ANALYSIS_REDIS_BLOCK_MS", "10000", None),
        (
            "MOMO_ANALYSIS_REDIS_BLOCK_MS",
            "10001",
            Some(AnalysisConfigError::UnsafeRedisBlock),
        ),
        (
            "MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS",
            "56000",
            Some(AnalysisConfigError::UnsafeLeaseRelationship),
        ),
    ] {
        let mut candidate = environment.clone();
        candidate.insert(name, String::from(value));
        assert_eq!(
            runtime(&candidate, cgroup.path()).err(),
            expected,
            "timing {name}={value}"
        );
    }
}

#[test]
fn runtime_preserves_the_cgroup_safety_gate() {
    let environment = runtime_environment();
    let activation = activation(&environment).expect("valid activation");
    let result = AnalysisConsumerConfig::from_lookup(
        &activation,
        &|name| environment.get(name).cloned(),
        |expected_limit| {
            assert_eq!(expected_limit, 134_217_728);
            Err(CgroupError::LimitMismatch)
        },
    );
    assert_eq!(
        result.err(),
        Some(AnalysisConfigError::ChildCgroup {
            kind: "cgroup_limit_mismatch"
        })
    );
}
