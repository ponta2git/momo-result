//! Executes one already-claimed analysis attempt; module lifecycle stays with `Module`.
use std::time::Instant;

use tokio::sync::watch;
use tracing::{Instrument, error, info, info_span, warn};

use super::{
    AttemptResult, ConsumerError, attempt,
    attempt::{child_spec, finish_attempt_result, run_claimed_child},
    attempt_directory::create_attempt_directory,
    config::AnalysisConsumerConfig,
    control::{self, AttemptFailure, SafeFailureCode, finish_failure},
    heartbeat::HeartbeatConnection,
    metrics::{PhaseTimer, elapsed_metrics, measure},
};
use crate::{
    postgres,
    worker::{ControlOutcome, PostCommitSink},
};

/// Reusable attempt resources move into the active task and return on every normal result.
pub(crate) struct Runner {
    pub(super) control_client: postgres::ConnectedClient,
    pub(super) heartbeat_client: HeartbeatConnection,
    pub(super) config: AnalysisConsumerConfig,
    pub(super) post_commit_sink: PostCommitSink,
}

impl Runner {
    pub(crate) async fn execute(
        &mut self,
        claim: control::ClaimedJob,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), ConsumerError> {
        let span = info_span!(
            "analysis_attempt",
            worker_id = %self.config.worker_id,
            job_id = %claim.job_id,
            attempt_id = %claim.attempt_id,
            game_title_id = %claim.game_title_id,
            attempt_no = claim.attempt_no,
            input_revision = claim.input_revision,
            algorithm_version = %claim.algorithm_version,
            artifact_schema_version = claim.artifact_schema_version,
            validation_contract_id = claim.validation_contract_id.as_deref().unwrap_or("missing"),
            fencing_token = claim.fencing_token,
        );
        async {
            let result = execute_claimed_job(
                &mut self.control_client,
                &mut self.heartbeat_client,
                &self.config,
                &self.post_commit_sink,
                &claim,
                &mut shutdown,
            )
            .await;
            if let Err(error) = &result {
                error!(
                    event = "analysis_attempt_runtime_failed",
                    phase = "control_plane",
                    error_kind = error.kind(),
                    "analysis attempt could not complete its control-plane transition"
                );
            }
            result.map(|_| ())
        }
        .instrument(span)
        .await
    }
}

fn submit_control_outcome<T>(
    sink: &PostCommitSink,
    outcome: ControlOutcome<T>,
) -> Result<T, ConsumerError> {
    sink.submit(outcome.effects)?;
    Ok(outcome.value)
}

async fn execute_claimed_job(
    control_client: &mut postgres::ConnectedClient,
    heartbeat_client: &mut HeartbeatConnection,
    config: &AnalysisConsumerConfig,
    post_commit_sink: &PostCommitSink,
    claim: &control::ClaimedJob,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<AttemptResult, ConsumerError> {
    info!(
        event = "analysis_attempt_claimed",
        phase = "claim",
        state = "running",
        "analysis attempt claimed"
    );

    let attempt_timer = PhaseTimer::start("attempt_after_claim");
    let started = Instant::now();
    let attempt_directory = match create_attempt_directory(config, claim).await {
        Ok(directory) => directory,
        Err(_error) => {
            let metrics = elapsed_metrics(started, None);
            let failure = AttemptFailure::failed(SafeFailureCode::TemporaryStorageExhausted);
            let outcome = attempt::finalize(config, |_deadline| async {
                Ok(finish_failure(control_client, claim, config, failure, &metrics).await?)
            })
            .await?;
            submit_control_outcome(post_commit_sink, outcome)?;
            warn!(
                event = "analysis_attempt_finished",
                phase = "temporary_storage_prepare",
                outcome = failure.outcome_wire(),
                safe_failure_code = failure.code_wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt failed before child startup"
            );
            return Ok(AttemptResult::Completed);
        }
    };
    let attempt_result = async {
        let child_spec = child_spec(config, claim, &attempt_directory)?;
        let result = run_claimed_child(
            heartbeat_client,
            config,
            claim,
            &child_spec,
            shutdown,
            started,
        )
        .await;
        let result =
            attempt::renew_before_publication(heartbeat_client, config, claim, shutdown, result)
                .await;
        let outcome = finish_attempt_result(
            control_client,
            config,
            claim,
            &attempt_directory,
            started,
            result,
        )
        .await?;
        submit_control_outcome(post_commit_sink, outcome)
    }
    .await;
    heartbeat_client.finish_attempt();
    let result = measure(
        "attempt_cleanup",
        cleanup_attempt_directory(&attempt_directory, attempt_result),
    )
    .await;
    if result.is_ok() {
        attempt_timer.complete();
    }
    result
}

/// Removes a completed attempt's non-authoritative files without hiding its control-plane result.
async fn cleanup_attempt_directory<T>(
    attempt_directory: &std::path::Path,
    attempt_result: Result<T, ConsumerError>,
) -> Result<T, ConsumerError> {
    let cleanup_result = tokio::fs::remove_dir_all(attempt_directory).await;
    if let Err(cleanup_error) = cleanup_result {
        error!(
            event = "analysis_attempt_cleanup_failed",
            phase = "temporary_storage_cleanup",
            error_kind = "temporary_storage_io",
            "analysis attempt directory cleanup failed"
        );
        return match attempt_result {
            Ok(_value) => Err(ConsumerError::Temporary(cleanup_error)),
            Err(attempt_error) => Err(attempt_error),
        };
    }
    attempt_result
}
