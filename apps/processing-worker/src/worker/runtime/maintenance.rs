//! Reuses owned attempt finalization while keeping normal scheduler and recovery entry points closed.
use futures_util::FutureExt;
use std::{panic::AssertUnwindSafe, time::Duration};
use tokio::{sync::watch, time};

use super::{
    Observation, PendingExecution, PostCommitSink, Runtime, Settings, WorkState, WorkerError,
    finish, preflight,
};
use crate::{
    maintenance::analysis::{BoundScope, ScopeError},
    postgres,
    series_analysis::{self, config::AnalysisConsumerConfig, control::ClaimResult},
};

pub(crate) async fn run(
    config: AnalysisConsumerConfig,
    scope: BoundScope,
    database: postgres::ConnectedClient,
    external: watch::Receiver<bool>,
    shutdown_deadline: &mut Option<time::Instant>,
) -> Result<(), WorkerError> {
    preflight(&config)?;
    let timeout = config
        .renewal_window()
        .checked_mul(3)
        .and_then(|duration| duration.checked_add(config.execution_limits.finalization_timeout))
        .and_then(|duration| duration.checked_add(config.child_stop_grace.saturating_mul(2)))
        .and_then(|duration| duration.checked_add(Duration::from_secs(10)))
        .ok_or(WorkerError::ShutdownDrainBudgetBound)?;
    let mut runtime = Runtime::new(external, timeout, config.child_stop_grace);
    runtime.advertise_capability = false;
    let (sink, wake) = PostCommitSink::channel();
    runtime.wake = Some(wake);
    let mut state = Some(WorkState::new(
        Settings::from(&config),
        Some(config.clone()),
        database,
        sink.clone(),
    ));
    let result = Box::pin(
        AssertUnwindSafe(async {
            let work = state.as_mut().ok_or(WorkerError::UnexpectedExit)?;
            scope.live_barrier().await?;
            work.analysis = Some(
                runtime
                    .operation(async {
                        Ok(
                            series_analysis::bootstrap::initialize_maintenance(config, sink)
                                .await?,
                        )
                    })
                    .await?,
            );
            Box::pin(drive(&mut runtime, work, &scope)).await
        })
        .catch_unwind(),
    )
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => runtime.fail(error),
        Err(_panic) => runtime.fail(WorkerError::Panicked),
    }
    let finished = finish(&mut runtime, &mut state).await;
    *shutdown_deadline = runtime.deadline;
    finished
}

async fn drive(
    runtime: &mut Runtime,
    work: &mut WorkState,
    scope: &BoundScope,
) -> Result<(), WorkerError> {
    while !runtime.stopping() {
        if let Some(runner) = runtime.returned.take() {
            work.restore(runner);
        }
        scope.live_barrier().await?;
        if runtime.active.is_some() {
            runtime
                .observe(
                    async {
                        time::sleep(Duration::from_millis(500)).await;
                        Ok(())
                    },
                    Observation::Idle,
                )
                .await?;
            continue;
        }
        let report = runtime
            .operation(async { Ok(scope.inspect(&mut work.database).await?) })
            .await?;
        if runtime.stopping() || report.status == "complete" {
            break;
        }
        if let Some(title) = report.next_pending_title {
            runtime
                .operation(async {
                    Ok(
                        series_analysis::materialization::expand_scoped_campaign_target(
                            &mut work.database,
                            scope,
                            &title,
                        )
                        .await?,
                    )
                })
                .await?;
            continue;
        }
        let job = report.next_job.ok_or(ScopeError::Plan)?;
        let config = work.config.as_ref().ok_or(WorkerError::UnexpectedExit)?;
        work.resources.reserve()?;
        let outcome = runtime
            .operation(async {
                Ok(series_analysis::control::claim_scoped_job(
                    &mut work.database,
                    &job,
                    config,
                    scope,
                )
                .await?)
            })
            .await?;
        work.sink.submit(outcome.effects)?;
        match outcome.value {
            ClaimResult::Claimed(claim) => {
                let runner = work
                    .analysis
                    .as_mut()
                    .and_then(series_analysis::Module::take_runner)
                    .ok_or(WorkerError::UnexpectedExit)?;
                runtime.start_attempt(PendingExecution::Analysis(runner, claim));
            }
            ClaimResult::NotYetAvailable { remaining_delay } => {
                work.resources.release();
                runtime
                    .observe(
                        async {
                            time::sleep(remaining_delay.min(Duration::from_millis(500))).await;
                            Ok(())
                        },
                        Observation::Idle,
                    )
                    .await?;
            }
            ClaimResult::RecoveredCurrentJob
            | ClaimResult::Busy
            | ClaimResult::MissingOrTerminal
            | ClaimResult::UnsupportedVersion(_) => return Err(ScopeError::Plan.into()),
        }
    }
    Ok(())
}
