use std::{pin::Pin, time::Instant};

use tokio::{sync::watch, time};
use tracing::{error, info, warn};

use crate::{
    outbox::ControlOutcome,
    postgres,
    process::{
        AnalysisChildOutcome, AnalysisChildProcessSpec, ManagedAnalysisChild, ProcessError,
        current_process_peak_resident_bytes,
    },
};

use super::{
    AttemptInterruption, ConsumerError, DeliveryDisposition, child_report,
    config::AnalysisConsumerConfig,
    control::{
        AttemptFailure, AttemptMetrics, ClaimedJob, ControlError, HeartbeatResult,
        PublicationResult, SafeFailureCode, artifact_id_for_attempt, finish_failure, heartbeat,
        publish, requeue_interrupted, retry_transient_failure, supersede,
    },
    metrics::{elapsed_metrics, signed_optional_quantity, signed_quantity},
    policy::{ChildAction, InterruptionAction, child_action, interruption_action},
};

#[derive(Debug)]
pub(super) enum ChildSupervisionFailure {
    Interrupted(AttemptInterruption),
    CleanupUnverified(ProcessError),
}

fn classify_spawn_failure(error: ProcessError) -> ChildSupervisionFailure {
    if error.spawn_cleanup_unverified() {
        ChildSupervisionFailure::CleanupUnverified(error)
    } else {
        ChildSupervisionFailure::Interrupted(AttemptInterruption::WorkerCrashed)
    }
}

fn resolve_interruption_after_cleanup(
    intended: AttemptInterruption,
    cleanup_result: Result<(), ProcessError>,
) -> ChildSupervisionFailure {
    match cleanup_result {
        Ok(()) => ChildSupervisionFailure::Interrupted(intended),
        Err(error) => ChildSupervisionFailure::CleanupUnverified(error),
    }
}

pub(super) fn child_spec(
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
) -> Result<AnalysisChildProcessSpec, ConsumerError> {
    let parent_liveness_timeout = config
        .heartbeat_interval
        .checked_mul(2)
        .ok_or(ConsumerError::DurationBound)?;
    Ok(AnalysisChildProcessSpec {
        identity: momo_analysis_core::child::AnalysisAttemptIdentity {
            game_title_id: claim.game_title_id.clone(),
            input_revision: claim.input_revision,
            artifact_id: artifact_id_for_attempt(&claim.attempt_id),
        },
        read_database_url: config.read_database_url.clone(),
        output_directory: attempt_directory.to_path_buf(),
        maximum_chunk_bytes: config.execution_limits.chunk_bytes_limit.get(),
        maximum_chunk_count: config.execution_limits.chunk_count_limit.get(),
        maximum_total_bytes: config.execution_limits.temporary_bytes_limit.get(),
        maximum_file_count: config.execution_limits.temporary_file_count_limit.get(),
        parent_liveness_timeout,
    })
}

pub(super) async fn finish_attempt_result(
    control_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    started: Instant,
    result: Result<(AnalysisChildOutcome, AttemptMetrics), ChildSupervisionFailure>,
) -> Result<ControlOutcome<DeliveryDisposition>, ConsumerError> {
    match result {
        Ok(result) => {
            finish_child_outcome(control_client, config, claim, attempt_directory, result).await
        }
        Err(ChildSupervisionFailure::Interrupted(interruption)) => {
            finish_interruption(control_client, config, claim, started, interruption).await
        }
        Err(ChildSupervisionFailure::CleanupUnverified(error)) => {
            // This return intentionally precedes every control-plane transition: an unverified
            // child boundary must retain its lease and Redis delivery for durable recovery.
            Err(ConsumerError::Process(error))
        }
    }
}

async fn finish_child_outcome(
    control_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    result: (AnalysisChildOutcome, AttemptMetrics),
) -> Result<ControlOutcome<DeliveryDisposition>, ConsumerError> {
    let (child_outcome, mut metrics) = result;
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    info!(
        event = "analysis_child_finished",
        phase = "calculation",
        child_outcome = child_outcome.wire(),
        calculation_milliseconds = metrics.calculation_milliseconds,
        child_peak_bytes = metrics.child_peak_bytes,
        "analysis child process exited"
    );
    let control_outcome = match child_action(child_outcome) {
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
            let control_outcome = supersede(control_client, claim, config, &metrics).await?;
            info!(
                event = "analysis_attempt_finished",
                phase = "revision_guard",
                outcome = "superseded",
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt was superseded"
            );
            control_outcome.map(|()| DeliveryDisposition::Acknowledge)
        }
        ChildAction::RetryTransient => {
            let control_outcome =
                retry_transient_failure(control_client, claim, config, &metrics).await?;
            let retry = control_outcome.value;
            warn!(
                event = "analysis_attempt_dependency_failure",
                phase = "input_snapshot",
                retry_disposition = retry.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis dependency failure was persisted"
            );
            control_outcome.map(|_| DeliveryDisposition::Acknowledge)
        }
        ChildAction::Fail(failure) => {
            let control_outcome =
                finish_failure(control_client, claim, config, failure, &metrics).await?;
            log_attempt_failure(failure, &metrics, "calculation");
            control_outcome.map(|()| DeliveryDisposition::Acknowledge)
        }
    };
    Ok(control_outcome)
}

async fn finish_interruption(
    control_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    started: Instant,
    interruption: AttemptInterruption,
) -> Result<ControlOutcome<DeliveryDisposition>, ConsumerError> {
    let mut metrics = elapsed_metrics(started, None);
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    let outcome = match interruption_action(interruption) {
        InterruptionAction::Fail(failure) => {
            let outcome = finish_failure(control_client, claim, config, failure, &metrics).await?;
            log_attempt_failure(failure, &metrics, "child_supervision");
            outcome.map(|()| DeliveryDisposition::Acknowledge)
        }
        InterruptionAction::Requeue {
            cause,
            stop_consumer,
        } => {
            let outcome =
                requeue_interrupted(control_client, claim, config, cause, &metrics).await?;
            info!(
                event = "analysis_attempt_requeued",
                phase = "child_supervision",
                reason = cause.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt was requeued without failure"
            );
            outcome.map(|()| {
                if stop_consumer {
                    DeliveryDisposition::StopLoop
                } else {
                    DeliveryDisposition::Acknowledge
                }
            })
        }
        InterruptionAction::LeavePending => {
            warn!(
                event = "analysis_attempt_owner_lost",
                phase = "heartbeat",
                reason = interruption.wire(),
                elapsed_milliseconds = metrics.elapsed_milliseconds,
                "analysis attempt ownership was lost"
            );
            ControlOutcome::without_effects(DeliveryDisposition::leave_pending_cold())
        }
    };
    Ok(outcome)
}

pub(super) async fn run_claimed_child(
    heartbeat_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    child_spec: &AnalysisChildProcessSpec,
    shutdown: &mut watch::Receiver<bool>,
    started: Instant,
) -> Result<(AnalysisChildOutcome, AttemptMetrics), ChildSupervisionFailure> {
    calculation_time_remaining(started, config.execution_limits.calculation_timeout)
        .map_err(ChildSupervisionFailure::Interrupted)?;
    let mut child = spawn_claimed_child(config, child_spec).await?;
    if let Some(result) =
        refresh_child_liveness(&mut child, started, config.child_stop_grace).await?
    {
        return Ok(finalize_child_result(child_spec, result));
    }
    let mut heartbeat_interval = time::interval(config.heartbeat_interval);
    heartbeat_interval.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    heartbeat_interval.tick().await;
    let mut sample_interval = time::interval(time::Duration::from_millis(100));
    sample_interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    sample_interval.tick().await;
    let remaining =
        match calculation_time_remaining(started, config.execution_limits.calculation_timeout) {
            Ok(remaining) => remaining,
            Err(interruption) => {
                return Err(terminate_for(&mut child, config.child_stop_grace, interruption).await);
            }
        };
    let deadline = calculation_deadline(remaining)?;
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
                            config.child_stop_grace,
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
                            config.child_stop_grace,
                            AttemptInterruption::WorkerCrashed,
                        ).await);
                    }
                }
            }
            _ = heartbeat_interval.tick() => {
                if let Some(result) = supervise_child_heartbeat(
                    heartbeat_client,
                    config,
                    claim,
                    &mut child,
                    shutdown,
                    started,
                    deadline.as_mut(),
                ).await? {
                    return Ok(finalize_child_result(child_spec, result));
                }
            }
            () = &mut deadline => {
                return Err(terminate_for(
                    &mut child,
                    config.child_stop_grace,
                    AttemptInterruption::TimedOut,
                ).await);
            }
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Err(terminate_for(
                        &mut child,
                        config.child_stop_grace,
                        AttemptInterruption::Shutdown,
                    ).await);
                }
            }
        }
    }
}

fn calculation_time_remaining(
    started: Instant,
    limit: time::Duration,
) -> Result<time::Duration, AttemptInterruption> {
    limit
        .checked_sub(started.elapsed())
        .filter(|remaining| !remaining.is_zero())
        .ok_or(AttemptInterruption::TimedOut)
}

fn calculation_deadline(remaining: time::Duration) -> Result<time::Sleep, ChildSupervisionFailure> {
    let deadline =
        time::Instant::now()
            .checked_add(remaining)
            .ok_or(ChildSupervisionFailure::Interrupted(
                AttemptInterruption::WorkerCrashed,
            ))?;
    Ok(time::sleep_until(deadline))
}

async fn spawn_claimed_child(
    config: &AnalysisConsumerConfig,
    child_spec: &AnalysisChildProcessSpec,
) -> Result<ManagedAnalysisChild, ChildSupervisionFailure> {
    ManagedAnalysisChild::spawn(child_spec, &config.child_cgroup, config.child_stop_grace)
        .await
        .map_err(|error| {
            error!(
                event = "analysis_child_start_failed",
                phase = "child_spawn",
                error_kind = error.kind(),
                cleanup_unverified = error.spawn_cleanup_unverified(),
                "analysis child process could not start"
            );
            classify_spawn_failure(error)
        })
}

type HeartbeatOperationResult = Result<Result<HeartbeatResult, ControlError>, time::error::Elapsed>;

async fn supervise_child_heartbeat(
    heartbeat_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    child: &mut ManagedAnalysisChild,
    shutdown: &mut watch::Receiver<bool>,
    started: Instant,
    deadline: Pin<&mut time::Sleep>,
) -> Result<Option<(AnalysisChildOutcome, AttemptMetrics)>, ChildSupervisionFailure> {
    let heartbeat_result =
        match supervise_heartbeat(heartbeat_client, claim, config, shutdown, deadline).await {
            Ok(result) => result,
            Err(interruption) => {
                return Err(terminate_for(child, config.child_stop_grace, interruption).await);
            }
        };
    handle_heartbeat_result(heartbeat_result, config, child, started).await
}

async fn supervise_heartbeat(
    heartbeat_client: &mut tokio_postgres::Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    shutdown: &mut watch::Receiver<bool>,
    mut deadline: Pin<&mut time::Sleep>,
) -> Result<HeartbeatOperationResult, AttemptInterruption> {
    let heartbeat_operation = time::timeout(
        config.heartbeat_interval,
        heartbeat(heartbeat_client, claim, config),
    );
    tokio::pin!(heartbeat_operation);
    loop {
        tokio::select! {
            biased;
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    return Err(AttemptInterruption::Shutdown);
                }
            }
            () = &mut deadline => return Err(AttemptInterruption::TimedOut),
            result = &mut heartbeat_operation => return Ok(result),
        }
    }
}

fn finalize_child_result(
    child_spec: &AnalysisChildProcessSpec,
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

async fn handle_heartbeat_result(
    heartbeat_result: HeartbeatOperationResult,
    config: &AnalysisConsumerConfig,
    child: &mut ManagedAnalysisChild,
    started: Instant,
) -> Result<Option<(AnalysisChildOutcome, AttemptMetrics)>, ChildSupervisionFailure> {
    match heartbeat_result {
        Ok(Ok(HeartbeatResult::Continue)) => {
            refresh_child_liveness(child, started, config.child_stop_grace).await
        }
        Ok(Ok(HeartbeatResult::PreemptRequested)) => Err(terminate_for(
            child,
            config.child_stop_grace,
            AttemptInterruption::Preempted,
        )
        .await),
        Ok(Ok(HeartbeatResult::OwnerLost)) => {
            warn!(
                event = "analysis_heartbeat_rejected",
                phase = "heartbeat",
                reason = "owner_lost",
                "analysis attempt heartbeat lost fencing ownership"
            );
            Err(terminate_for(
                child,
                config.child_stop_grace,
                AttemptInterruption::OwnerLost,
            )
            .await)
        }
        Ok(Err(error)) => {
            warn!(
                event = "analysis_heartbeat_failed",
                phase = "heartbeat",
                reason = "dependency_error",
                error_kind = error.kind(),
                "analysis attempt heartbeat failed"
            );
            Err(terminate_for(
                child,
                config.child_stop_grace,
                AttemptInterruption::OwnerLost,
            )
            .await)
        }
        Err(_elapsed) => {
            warn!(
                event = "analysis_heartbeat_failed",
                phase = "heartbeat",
                reason = "timeout",
                "analysis attempt heartbeat timed out"
            );
            Err(terminate_for(
                child,
                config.child_stop_grace,
                AttemptInterruption::OwnerLost,
            )
            .await)
        }
    }
}

async fn refresh_child_liveness(
    child: &mut ManagedAnalysisChild,
    started: Instant,
    child_stop_grace: time::Duration,
) -> Result<Option<(AnalysisChildOutcome, AttemptMetrics)>, ChildSupervisionFailure> {
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
            Err(terminate_for(child, child_stop_grace, AttemptInterruption::WorkerCrashed).await)
        }
    }
}

async fn terminate_for(
    child: &mut ManagedAnalysisChild,
    grace: time::Duration,
    intended: AttemptInterruption,
) -> ChildSupervisionFailure {
    let resolution =
        resolve_interruption_after_cleanup(intended, child.terminate(grace).await.map(drop));
    if let ChildSupervisionFailure::CleanupUnverified(error) = &resolution {
        error!(
            event = "analysis_child_termination_failed",
            phase = "child_termination",
            intended_outcome = intended.wire(),
            error_kind = error.kind(),
            "analysis child termination or reap failed"
        );
    }
    resolution
}

async fn finish_successful_child(
    control_client: &mut tokio_postgres::Client,
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    attempt_directory: &std::path::Path,
    metrics: &mut AttemptMetrics,
) -> Result<ControlOutcome<DeliveryDisposition>, ConsumerError> {
    let publication_started = Instant::now();
    let result = time::timeout(
        config.execution_limits.finalization_timeout,
        publish(control_client, claim, config, attempt_directory, metrics),
    )
    .await;
    metrics.observe_worker_peak(current_process_peak_resident_bytes().await);
    match result {
        Ok(Ok(outcome)) => match outcome.value {
            publication @ (PublicationResult::Published | PublicationResult::Reused) => {
                log_attempt_success(publication, metrics);
                Ok(outcome.map(|_| DeliveryDisposition::Acknowledge))
            }
            PublicationResult::Superseded => {
                info!(
                    event = "analysis_attempt_finished",
                    phase = "publication_revision_guard",
                    outcome = "superseded",
                    elapsed_milliseconds = metrics.elapsed_milliseconds,
                    "analysis attempt was superseded during publication"
                );
                Ok(outcome.map(|_| DeliveryDisposition::Acknowledge))
            }
            PublicationResult::IntegrityFailure(failure_code) => {
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
                Ok(outcome.map(|_| DeliveryDisposition::Acknowledge))
            }
        },
        Ok(Err(ControlError::OwnerLost)) => {
            warn!(
                event = "analysis_publication_rejected",
                phase = "publication",
                reason = "owner_lost",
                "analysis publication lost fencing ownership"
            );
            Ok(ControlOutcome::without_effects(
                DeliveryDisposition::leave_pending_cold(),
            ))
        }
        Ok(Err(error)) if error.is_artifact_candidate_failure() => {
            metrics.record_staging(publication_started.elapsed());
            warn!(
                event = "analysis_publication_failed",
                phase = "artifact_validation",
                error_kind = error.kind(),
                "analysis artifact validation failed"
            );
            let failure = AttemptFailure::failed(SafeFailureCode::ArtifactValidationFailed);
            let outcome = finish_failure(control_client, claim, config, failure, metrics).await?;
            log_attempt_failure(failure, metrics, "artifact_validation");
            Ok(outcome.map(|()| DeliveryDisposition::Acknowledge))
        }
        Ok(Err(error)) if error.is_candidate_processing_infrastructure_failure() => {
            metrics.record_finalization(publication_started.elapsed());
            error!(
                event = "analysis_publication_failed",
                phase = "candidate_processing",
                error_kind = error.kind(),
                "analysis candidate processing lost a trusted runtime boundary"
            );
            // No control-plane transition and no ACK: a validator task failure or an I/O failure
            // after validation says nothing authoritative about the child candidate. Lease
            // recovery is the only safe path.
            Err(ConsumerError::Control(error))
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
    config: &AnalysisConsumerConfig,
    claim: &ClaimedJob,
    metrics: &AttemptMetrics,
) -> Result<ControlOutcome<DeliveryDisposition>, ConsumerError> {
    let mut recovery_client = postgres::connect(&config.database_url).await?;
    let failure = AttemptFailure::failed(SafeFailureCode::PublicationFailed);
    match finish_failure(&mut recovery_client, claim, config, failure, metrics).await {
        Ok(outcome) => {
            log_attempt_failure(failure, metrics, "publication");
            Ok(outcome.map(|()| DeliveryDisposition::Acknowledge))
        }
        Err(ControlError::OwnerLost) => Ok(ControlOutcome::without_effects(
            DeliveryDisposition::leave_pending_cold(),
        )),
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
    use std::{io, time::Duration};

    use tempfile::TempDir;

    use super::*;
    use crate::series_analysis::child_report::{
        ChildPhase, ChildReport, ChildReportMetrics, ChildReportOutcome, write,
    };

    fn test_child_spec(directory: &std::path::Path) -> AnalysisChildProcessSpec {
        AnalysisChildProcessSpec {
            identity: momo_analysis_core::child::AnalysisAttemptIdentity {
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
    fn spawn_failure_is_structural_only_when_a_created_child_may_remain() {
        let pure_spawn_failure = classify_spawn_failure(ProcessError::Spawn(io::Error::other(
            "fixture process was never created",
        )));
        assert!(matches!(
            pure_spawn_failure,
            ChildSupervisionFailure::Interrupted(AttemptInterruption::WorkerCrashed)
        ));

        let cleanup_unverified = classify_spawn_failure(ProcessError::SpawnCleanupUnverified {
            setup_kind: "child_start_barrier",
            cleanup_kind: "child_stop_timeout",
        });
        assert!(matches!(
            cleanup_unverified,
            ChildSupervisionFailure::CleanupUnverified(ProcessError::SpawnCleanupUnverified {
                setup_kind: "child_start_barrier",
                cleanup_kind: "child_stop_timeout",
            })
        ));
        assert!(matches!(
            classify_spawn_failure(ProcessError::MissingProcessId),
            ChildSupervisionFailure::CleanupUnverified(ProcessError::MissingProcessId)
        ));
    }

    #[test]
    fn intended_policy_requires_verified_termination_and_reap() {
        for intended in [
            AttemptInterruption::TimedOut,
            AttemptInterruption::Preempted,
            AttemptInterruption::Shutdown,
            AttemptInterruption::OwnerLost,
            AttemptInterruption::WorkerCrashed,
        ] {
            assert!(matches!(
                resolve_interruption_after_cleanup(intended, Ok(())),
                ChildSupervisionFailure::Interrupted(actual) if actual == intended
            ));
        }

        let cleanup_unverified = resolve_interruption_after_cleanup(
            AttemptInterruption::TimedOut,
            Err(ProcessError::StopTimeout),
        );
        assert!(matches!(
            cleanup_unverified,
            ChildSupervisionFailure::CleanupUnverified(ProcessError::StopTimeout)
        ));
    }

    #[test]
    fn candidate_file_failures_are_not_misreported_as_publication_dependency_failures() {
        let metadata_parse = "not-a-revision".parse::<i64>();
        assert!(metadata_parse.is_err());
        let Some(metadata_parse) = metadata_parse.err() else {
            return;
        };
        for error in [
            ControlError::InvalidMetadata,
            ControlError::MetadataParse(metadata_parse),
            ControlError::ChildArtifactMetrics,
        ] {
            assert!(error.is_artifact_candidate_failure());
        }
        let host_io = ControlError::Io(io::Error::other("fixture staging read"));
        assert!(!host_io.is_artifact_candidate_failure());
        assert!(host_io.is_candidate_processing_infrastructure_failure());
        assert!(!ControlError::PublicationRowCount.is_artifact_candidate_failure());
        assert!(!ControlError::OwnerLost.is_artifact_candidate_failure());
    }

    #[test]
    fn authoritative_input_corruption_is_propagated_without_candidate_failure_or_ack() {
        let error = ControlError::AuthoritativeInputContract;

        assert!(error.is_candidate_processing_infrastructure_failure());
        assert!(!error.is_artifact_candidate_failure());
    }

    #[tokio::test]
    async fn validator_task_failure_is_structural_not_a_bad_candidate() {
        let join = tokio::spawn(async { panic!("validator fixture panic") }).await;
        assert!(join.is_err());
        let Some(join_error) = join.err() else {
            return;
        };
        let error = ControlError::ArtifactValidationTask(join_error);

        assert!(error.is_candidate_processing_infrastructure_failure());
        assert!(!error.is_artifact_candidate_failure());
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
