use std::time::Instant;

use tokio::{sync::watch, time};
use tracing::{error, info, warn};

use crate::{
    database,
    process::{
        AnalysisChildOutcome, AnalysisChildSpec, ManagedAnalysisChild,
        current_process_peak_resident_bytes,
    },
};

use super::{
    AttemptInterruption, ConsumerError, DeliveryDisposition, child_report,
    config::WorkerRuntimeConfig,
    control::{
        AttemptFailure, AttemptMetrics, ClaimedJob, ControlError, HeartbeatResult,
        PublicationResult, SafeFailureCode, artifact_id_for_attempt, finish_failure, heartbeat,
        publish, requeue_interrupted, retry_transient_failure, supersede,
    },
    metrics::{elapsed_metrics, signed_optional_quantity, signed_quantity},
    policy::{ChildAction, InterruptionAction, child_action, interruption_action},
};

pub(super) fn child_spec(
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
) -> Result<AnalysisChildSpec, ConsumerError> {
    let parent_liveness_timeout = config
        .heartbeat_interval
        .checked_mul(2)
        .ok_or(ConsumerError::DurationBound)?;
    Ok(AnalysisChildSpec {
        request: momo_analysis_core::child::AnalysisChildRequest {
            game_title_id: claim.game_title_id.clone(),
            input_revision: claim.input_revision,
            artifact_id: artifact_id_for_attempt(&claim.attempt_id),
        },
        read_database_url: config.read_database_url.clone(),
        output_directory: attempt_directory.to_path_buf(),
        maximum_chunk_bytes: config.publication_limits.chunk_bytes_limit.get(),
        maximum_chunk_count: config.publication_limits.chunk_count_limit.get(),
        maximum_total_bytes: config.publication_limits.temporary_bytes_limit.get(),
        maximum_file_count: config.publication_limits.temporary_file_count_limit.get(),
        parent_liveness_timeout,
    })
}

pub(super) async fn finish_attempt_result(
    control_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    started: Instant,
    result: Result<(AnalysisChildOutcome, AttemptMetrics), AttemptInterruption>,
) -> Result<DeliveryDisposition, ConsumerError> {
    match result {
        Ok(result) => {
            finish_child_outcome(control_client, config, claim, attempt_directory, result).await
        }
        Err(interruption) => {
            finish_interruption(control_client, config, claim, started, interruption).await
        }
    }
}

async fn finish_child_outcome(
    control_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    result: (AnalysisChildOutcome, AttemptMetrics),
) -> Result<DeliveryDisposition, ConsumerError> {
    let (outcome, mut metrics) = result;
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    info!(
        event = "analysis_child_finished",
        phase = "calculation",
        child_outcome = outcome.wire(),
        calculation_milliseconds = metrics.calculation_milliseconds,
        child_peak_bytes = metrics.child_peak_bytes,
        "analysis child process exited"
    );
    let disposition = match child_action(outcome) {
        ChildAction::Publish => {
            finish_successful_child(
                control_client,
                config,
                claim,
                attempt_directory,
                &mut metrics,
            )
            .await?
        }
        ChildAction::Supersede => {
            supersede(control_client, claim, config, &metrics).await?;
            info!(
                event = "analysis_attempt_finished",
                phase = "revision_guard",
                outcome = "superseded",
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt was superseded"
            );
            DeliveryDisposition::Acknowledge
        }
        ChildAction::RetryTransient => {
            let retry = retry_transient_failure(control_client, claim, config, &metrics).await?;
            warn!(
                event = "analysis_attempt_dependency_failure",
                phase = "input_snapshot",
                retry_disposition = retry.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis dependency failure was persisted"
            );
            DeliveryDisposition::Acknowledge
        }
        ChildAction::Fail(failure) => {
            finish_failure(control_client, claim, config, failure, &metrics).await?;
            log_attempt_failure(failure, &metrics, "calculation");
            DeliveryDisposition::Acknowledge
        }
    };
    Ok(disposition)
}

async fn finish_interruption(
    control_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    started: Instant,
    interruption: AttemptInterruption,
) -> Result<DeliveryDisposition, ConsumerError> {
    let mut metrics = elapsed_metrics(started, None);
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    let disposition = match interruption_action(interruption) {
        InterruptionAction::Fail(failure) => {
            finish_failure(control_client, claim, config, failure, &metrics).await?;
            log_attempt_failure(failure, &metrics, "child_supervision");
            DeliveryDisposition::Acknowledge
        }
        InterruptionAction::Requeue { cause, stop } => {
            requeue_interrupted(control_client, claim, config, cause, &metrics).await?;
            info!(
                event = "analysis_attempt_requeued",
                phase = "child_supervision",
                reason = cause.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt was requeued without failure"
            );
            if stop {
                DeliveryDisposition::Stop
            } else {
                DeliveryDisposition::Acknowledge
            }
        }
        InterruptionAction::LeavePending => {
            warn!(
                event = "analysis_attempt_owner_lost",
                phase = "heartbeat",
                reason = interruption.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt ownership was lost"
            );
            DeliveryDisposition::LeavePending
        }
    };
    Ok(disposition)
}

pub(super) async fn run_claimed_child(
    heartbeat_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    child_spec: &AnalysisChildSpec,
    shutdown: &mut watch::Receiver<bool>,
    started: Instant,
) -> Result<(AnalysisChildOutcome, AttemptMetrics), AttemptInterruption> {
    let mut child = ManagedAnalysisChild::spawn(child_spec, &config.child_cgroup)
        .await
        .map_err(|error| {
            error!(
                event = "analysis_child_start_failed",
                phase = "child_spawn",
                error_kind = error.kind(),
                "analysis child process could not start"
            );
            AttemptInterruption::WorkerCrashed
        })?;
    if let Some(result) = refresh_child_liveness(&mut child, started, config.shutdown_grace).await?
    {
        return Ok(finalize_child_result(child_spec, result));
    }
    let mut heartbeat_interval = time::interval(config.heartbeat_interval);
    heartbeat_interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    heartbeat_interval.tick().await;
    let mut sample_interval = time::interval(time::Duration::from_millis(100));
    sample_interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    sample_interval.tick().await;
    let deadline = time::sleep(config.publication_limits.calculation_timeout);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = sample_interval.tick() => {
                match child.try_wait() {
                    Ok(Some(outcome)) => {
                        return Ok(finalize_child_result(
                            child_spec,
                            (outcome, elapsed_metrics(started, child.peak_resident_bytes())),
                        ));
                    }
                    Ok(None) => {
                        if let Some(result) = refresh_child_liveness(
                            &mut child,
                            started,
                            config.shutdown_grace,
                        )
                        .await?
                        {
                            return Ok(finalize_child_result(child_spec, result));
                        }
                        child.sample_resident_bytes().await;
                    }
                    Err(error) => {
                        error!(
                            event = "analysis_child_wait_failed",
                            phase = "child_wait",
                            error_kind = error.kind(),
                            "analysis child process state could not be read"
                        );
                        return Err(terminate_for(
                            &mut child,
                            config.shutdown_grace,
                            AttemptInterruption::WorkerCrashed,
                        ).await);
                    }
                }
            }
            _ = heartbeat_interval.tick() => {
                if let Some(result) = handle_heartbeat(
                    heartbeat_client,
                    config,
                    claim,
                    &mut child,
                    started,
                ).await? {
                    return Ok(finalize_child_result(child_spec, result));
                }
            }
            () = &mut deadline => {
                return Err(terminate_for(
                    &mut child,
                    config.shutdown_grace,
                    AttemptInterruption::TimedOut,
                ).await);
            }
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Err(terminate_for(
                        &mut child,
                        config.shutdown_grace,
                        AttemptInterruption::Shutdown,
                    ).await);
                }
            }
        }
    }
}

fn finalize_child_result(
    child_spec: &AnalysisChildSpec,
    result: (AnalysisChildOutcome, AttemptMetrics),
) -> (AnalysisChildOutcome, AttemptMetrics) {
    let (outcome, mut metrics) = result;
    match child_report::take(&child_spec.output_directory) {
        Ok(report) if child_report::matches_process_outcome(report.outcome, outcome) => {
            metrics.input_milliseconds = Some(signed_quantity(report.input_milliseconds));
            metrics.kernel_milliseconds = Some(signed_quantity(report.calculation_milliseconds));
            metrics.encoding_milliseconds = Some(signed_quantity(report.encoding_milliseconds));
            metrics.input_row_count = Some(signed_quantity(report.input_row_count));
            metrics.artifact_chunk_count = Some(signed_quantity(report.artifact_chunk_count));
            metrics.artifact_encoded_bytes = Some(signed_quantity(report.artifact_payload_bytes));
            metrics.child_peak_bytes = metrics
                .child_peak_bytes
                .max(signed_optional_quantity(report.peak_resident_bytes));
            info!(
                event = "analysis_child_report_accepted",
                phase = "child_report",
                child_outcome = outcome.wire(),
                terminal_phase = report.terminal_phase.wire(),
                child_total_milliseconds = report.total_milliseconds,
                input_milliseconds = report.input_milliseconds,
                kernel_milliseconds = report.calculation_milliseconds,
                encoding_milliseconds = report.encoding_milliseconds,
                input_row_count = report.input_row_count,
                artifact_chunk_count = report.artifact_chunk_count,
                artifact_payload_bytes = report.artifact_payload_bytes,
                artifact_temporary_bytes = report.artifact_temporary_bytes,
                child_self_peak_bytes = report.peak_resident_bytes,
                "analysis child diagnostic report was accepted"
            );
            (outcome, metrics)
        }
        Ok(report) => {
            error!(
                event = "analysis_child_report_rejected",
                phase = "child_report",
                error_kind = "outcome_mismatch",
                child_outcome = outcome.wire(),
                terminal_phase = report.terminal_phase.wire(),
                "analysis child diagnostic report contradicted its exit status"
            );
            let effective = if outcome == AnalysisChildOutcome::Succeeded {
                AnalysisChildOutcome::CalculationFailed
            } else {
                outcome
            };
            (effective, metrics)
        }
        Err(error) => {
            let required = outcome == AnalysisChildOutcome::Succeeded;
            if required {
                error!(
                    event = "analysis_child_report_rejected",
                    phase = "child_report",
                    error_kind = error.kind(),
                    child_outcome = outcome.wire(),
                    "successful analysis child omitted a valid diagnostic report"
                );
            } else {
                warn!(
                    event = "analysis_child_report_unavailable",
                    phase = "child_report",
                    error_kind = error.kind(),
                    child_outcome = outcome.wire(),
                    "failed analysis child did not leave a usable diagnostic report"
                );
            }
            let effective = if required {
                AnalysisChildOutcome::CalculationFailed
            } else {
                outcome
            };
            (effective, metrics)
        }
    }
}

async fn handle_heartbeat(
    heartbeat_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    child: &mut ManagedAnalysisChild,
    started: Instant,
) -> Result<Option<(AnalysisChildOutcome, AttemptMetrics)>, AttemptInterruption> {
    match time::timeout(
        config.heartbeat_interval,
        heartbeat(heartbeat_client, claim, config),
    )
    .await
    {
        Ok(Ok(HeartbeatResult::Continue)) => {
            refresh_child_liveness(child, started, config.shutdown_grace).await
        }
        Ok(Ok(HeartbeatResult::PreemptRequested)) => {
            Err(terminate_for(child, config.shutdown_grace, AttemptInterruption::Preempted).await)
        }
        Ok(Ok(HeartbeatResult::OwnerLost)) => {
            warn!(
                event = "analysis_heartbeat_rejected",
                phase = "heartbeat",
                reason = "owner_lost",
                "analysis attempt heartbeat lost fencing ownership"
            );
            Err(terminate_for(child, config.shutdown_grace, AttemptInterruption::OwnerLost).await)
        }
        Ok(Err(error)) => {
            warn!(
                event = "analysis_heartbeat_failed",
                phase = "heartbeat",
                reason = "dependency_error",
                error_kind = error.kind(),
                "analysis attempt heartbeat failed"
            );
            Err(terminate_for(child, config.shutdown_grace, AttemptInterruption::OwnerLost).await)
        }
        Err(_elapsed) => {
            warn!(
                event = "analysis_heartbeat_failed",
                phase = "heartbeat",
                reason = "timeout",
                "analysis attempt heartbeat timed out"
            );
            Err(terminate_for(child, config.shutdown_grace, AttemptInterruption::OwnerLost).await)
        }
    }
}

async fn refresh_child_liveness(
    child: &mut ManagedAnalysisChild,
    started: Instant,
    shutdown_grace: time::Duration,
) -> Result<Option<(AnalysisChildOutcome, AttemptMetrics)>, AttemptInterruption> {
    match child.refresh_liveness() {
        Ok(()) => return Ok(None),
        Err(error) => {
            warn!(
                event = "analysis_child_liveness_failed",
                phase = "child_liveness",
                error_kind = error.kind(),
                "analysis child liveness refresh failed"
            );
        }
    }
    match child.try_wait() {
        Ok(Some(outcome)) => Ok(Some((
            outcome,
            elapsed_metrics(started, child.peak_resident_bytes()),
        ))),
        Ok(None) | Err(_) => {
            Err(terminate_for(child, shutdown_grace, AttemptInterruption::WorkerCrashed).await)
        }
    }
}

async fn terminate_for(
    child: &mut ManagedAnalysisChild,
    grace: time::Duration,
    intended: AttemptInterruption,
) -> AttemptInterruption {
    match child.terminate(grace).await {
        Ok(_) => intended,
        Err(error) => {
            error!(
                event = "analysis_child_termination_failed",
                phase = "child_termination",
                intended_outcome = intended.wire(),
                error_kind = error.kind(),
                "analysis child termination or reap failed"
            );
            AttemptInterruption::WorkerCrashed
        }
    }
}

async fn finish_successful_child(
    control_client: &mut tokio_postgres::Client,
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    metrics: &mut AttemptMetrics,
) -> Result<DeliveryDisposition, ConsumerError> {
    let publication_started = Instant::now();
    let result = time::timeout(
        config.publication_limits.finalization_timeout,
        publish(control_client, claim, config, attempt_directory, metrics),
    )
    .await;
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    match result {
        Ok(Ok(publication @ (PublicationResult::Published | PublicationResult::Reused))) => {
            log_attempt_success(publication, metrics);
            Ok(DeliveryDisposition::Acknowledge)
        }
        Ok(Ok(PublicationResult::Superseded)) => {
            info!(
                event = "analysis_attempt_finished",
                phase = "publication_revision_guard",
                outcome = "superseded",
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt was superseded during publication"
            );
            Ok(DeliveryDisposition::Acknowledge)
        }
        Ok(Ok(PublicationResult::IntegrityFailure(failure_code))) => {
            warn!(
                event = "analysis_attempt_finished",
                phase = "publication_integrity",
                outcome = "failed",
                safe_failure_code = failure_code.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                calculation_milliseconds = metrics.calculation_milliseconds,
                staging_milliseconds = metrics.staging_milliseconds,
                publication_milliseconds = metrics.publication_milliseconds,
                "analysis artifact integrity failure was persisted"
            );
            Ok(DeliveryDisposition::Acknowledge)
        }
        Ok(Err(ControlError::OwnerLost)) => {
            warn!(
                event = "analysis_publication_rejected",
                phase = "publication",
                reason = "owner_lost",
                "analysis publication lost fencing ownership"
            );
            Ok(DeliveryDisposition::LeavePending)
        }
        Ok(Err(error @ (ControlError::Artifact(_) | ControlError::ChildArtifactMetrics))) => {
            metrics.record_staging(publication_started.elapsed());
            warn!(
                event = "analysis_publication_failed",
                phase = "artifact_validation",
                error_kind = error.kind(),
                "analysis artifact validation failed"
            );
            let failure = AttemptFailure::failed(SafeFailureCode::ArtifactValidationFailed);
            finish_failure(control_client, claim, config, failure, metrics).await?;
            log_attempt_failure(failure, metrics, "artifact_validation");
            Ok(DeliveryDisposition::Acknowledge)
        }
        Ok(Err(error)) => {
            metrics.record_finalization(publication_started.elapsed());
            error!(
                event = "analysis_publication_failed",
                phase = "publication",
                error_kind = error.kind(),
                "analysis publication dependency failed"
            );
            finish_publication_failure(config, claim, metrics).await
        }
        Err(_elapsed) => {
            metrics.record_finalization(publication_started.elapsed());
            error!(
                event = "analysis_publication_failed",
                phase = "publication",
                error_kind = "finalization_timeout",
                "analysis publication exceeded its finalization deadline"
            );
            finish_publication_failure(config, claim, metrics).await
        }
    }
}

fn log_attempt_success(publication: PublicationResult, metrics: &AttemptMetrics) {
    info!(
        event = "analysis_attempt_finished",
        phase = "publication",
        outcome = "succeeded",
        publication_result = publication.wire(),
        elapsed_milliseconds = metrics.elapsed_milliseconds,
        calculation_milliseconds = metrics.calculation_milliseconds,
        staging_milliseconds = metrics.staging_milliseconds,
        publication_milliseconds = metrics.publication_milliseconds,
        child_peak_bytes = metrics.child_peak_bytes,
        worker_peak_bytes = metrics.worker_peak_bytes,
        artifact_chunk_count = metrics.artifact_chunk_count,
        artifact_encoded_bytes = metrics.artifact_encoded_bytes,
        input_milliseconds = metrics.input_milliseconds,
        kernel_milliseconds = metrics.kernel_milliseconds,
        encoding_milliseconds = metrics.encoding_milliseconds,
        input_row_count = metrics.input_row_count,
        "analysis attempt completed"
    );
}

async fn finish_publication_failure(
    config: &WorkerRuntimeConfig,
    claim: &ClaimedJob,
    metrics: &AttemptMetrics,
) -> Result<DeliveryDisposition, ConsumerError> {
    let mut recovery_client = database::connect(&config.database_url).await?;
    let failure = AttemptFailure::failed(SafeFailureCode::PublicationFailed);
    match finish_failure(&mut recovery_client, claim, config, failure, metrics).await {
        Ok(()) => {
            log_attempt_failure(failure, metrics, "publication");
            Ok(DeliveryDisposition::Acknowledge)
        }
        Err(ControlError::OwnerLost) => Ok(DeliveryDisposition::LeavePending),
        Err(error) => Err(ConsumerError::Control(error)),
    }
}

fn log_attempt_failure(failure: AttemptFailure, metrics: &AttemptMetrics, phase: &'static str) {
    warn!(
        event = "analysis_attempt_finished",
        phase,
        outcome = failure.outcome_wire(),
        safe_failure_code = failure.code_wire(),
        elapsed_milliseconds = metrics.elapsed_milliseconds,
        calculation_milliseconds = metrics.calculation_milliseconds,
        staging_milliseconds = metrics.staging_milliseconds,
        publication_milliseconds = metrics.publication_milliseconds,
        child_peak_bytes = metrics.child_peak_bytes,
        worker_peak_bytes = metrics.worker_peak_bytes,
        artifact_chunk_count = metrics.artifact_chunk_count,
        artifact_encoded_bytes = metrics.artifact_encoded_bytes,
        input_milliseconds = metrics.input_milliseconds,
        kernel_milliseconds = metrics.kernel_milliseconds,
        encoding_milliseconds = metrics.encoding_milliseconds,
        input_row_count = metrics.input_row_count,
        "analysis attempt failure was persisted"
    );
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "temporary child-report fixtures must expose their originating setup error"
)]
mod tests {
    use std::time::Duration;

    use tempfile::TempDir;

    use super::*;
    use crate::series_analysis::child_report::{
        ChildPhase, ChildReport, ChildReportMetrics, ChildReportOutcome, write,
    };

    fn test_child_spec(directory: &std::path::Path) -> AnalysisChildSpec {
        AnalysisChildSpec {
            request: momo_analysis_core::child::AnalysisChildRequest {
                game_title_id: String::from("title-1"),
                input_revision: 1,
                artifact_id: String::from("artifact-1"),
            },
            read_database_url: String::from("postgresql://unused"),
            output_directory: directory.to_path_buf(),
            maximum_chunk_bytes: 1_024,
            maximum_chunk_count: 10,
            maximum_total_bytes: 8_192,
            maximum_file_count: 11,
            parent_liveness_timeout: Duration::from_secs(1),
        }
    }

    #[test]
    fn successful_exit_requires_a_matching_child_report() {
        let directory =
            TempDir::new().unwrap_or_else(|error| panic!("temporary directory: {error}"));
        let spec = test_child_spec(directory.path());

        let (missing_outcome, _) = finalize_child_result(
            &spec,
            (AnalysisChildOutcome::Succeeded, AttemptMetrics::default()),
        );
        assert_eq!(missing_outcome, AnalysisChildOutcome::CalculationFailed);

        write(
            directory.path(),
            &ChildReport::new(
                ChildReportOutcome::Succeeded,
                ChildPhase::Complete,
                ChildReportMetrics {
                    total_milliseconds: 9,
                    input_milliseconds: 2,
                    calculation_milliseconds: 3,
                    encoding_milliseconds: 4,
                    input_row_count: 2_000,
                    artifact_chunk_count: 42,
                    artifact_payload_bytes: 8_192,
                    artifact_temporary_bytes: 9_216,
                    peak_resident_bytes: Some(32_768),
                },
            ),
        )
        .unwrap_or_else(|error| panic!("write child report: {error}"));
        let (outcome, metrics) = finalize_child_result(
            &spec,
            (AnalysisChildOutcome::Succeeded, AttemptMetrics::default()),
        );

        assert_eq!(outcome, AnalysisChildOutcome::Succeeded);
        assert_eq!(metrics.input_milliseconds, Some(2));
        assert_eq!(metrics.kernel_milliseconds, Some(3));
        assert_eq!(metrics.encoding_milliseconds, Some(4));
        assert_eq!(metrics.input_row_count, Some(2_000));
        assert_eq!(metrics.artifact_chunk_count, Some(42));
        assert_eq!(metrics.artifact_encoded_bytes, Some(8_192));
        assert_eq!(metrics.child_peak_bytes, Some(32_768));
    }
}
