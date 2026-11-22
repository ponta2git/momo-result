//! Analysis-specific startup after the worker has validated shared process prerequisites.
use std::time::Instant;

use tracing::{error, info};

use super::{
    ConsumerError, MaintenanceSchedules, Module, Runner,
    attempt_directory::{cleanup_stale_attempt_directories, validate_temporary_root},
    attestation::Admission,
    config::AnalysisConsumerConfig,
    heartbeat::HeartbeatConnection,
};
use crate::{postgres, worker::PostCommitSink};

/// Constructs reusable resources, validates read credentials, then advertises capability last.
/// Shared platform, identity and empty-cgroup checks belong to the worker bootstrap.
pub(crate) async fn initialize(
    config: AnalysisConsumerConfig,
    post_commit_sink: PostCommitSink,
) -> Result<Module, ConsumerError> {
    startup_result(
        validate_temporary_root(&config).await,
        "temporary_storage_validation",
    )?;
    let mut control_client = startup_result(
        postgres::connect(&config.database_url).await,
        "control_database_connect",
    )?;
    let heartbeat_client = startup_result(
        HeartbeatConnection::connect(&config.database_url).await,
        "heartbeat_database_connect",
    )?;
    let read_client = startup_result(
        postgres::connect(&config.read_database_url).await,
        "read_database_connect",
    )?;
    // A fresh startup must authenticate every configured database credential. The calculation
    // child opens its own read-only connection later, so this probe is intentionally not retained.
    drop(read_client);
    let stale_attempt_cleanup_due = startup_result(
        cleanup_stale_attempt_directories(&config, &control_client).await,
        "temporary_storage_recovery",
    )?;

    let admission = Admission::start(
        &mut control_client,
        &config.database_url,
        &config.worker_id,
        post_commit_sink.clone(),
    )
    .await?;
    let module = Module {
        admission,
        config: config.clone(),
        maintenance: MaintenanceSchedules {
            stale_attempt_cleanup_due,
            history_cleanup_due: Instant::now(),
        },
        runner: Some(Runner {
            control_client,
            heartbeat_client,
            config,
            post_commit_sink,
        }),
    };
    info!(event = "analysis_worker_ready", worker_id = %module.config.worker_id, "analysis worker is ready");
    Ok(module)
}

fn startup_result<T, E>(result: Result<T, E>, phase: &'static str) -> Result<T, ConsumerError>
where
    E: Into<ConsumerError>,
{
    result.map_err(|source| {
        let error = source.into();
        log_startup_failure(phase, &error);
        error
    })
}

fn log_startup_failure(phase: &'static str, error: &ConsumerError) {
    error!(
        event = "analysis_worker_startup_failed",
        phase,
        error_kind = error.kind(),
        "analysis worker startup boundary failed"
    );
}
