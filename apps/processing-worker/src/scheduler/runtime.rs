use super::{PostCommitSink, PostCommitSinkClosed, WakeReceiver, listener, selection};
use crate::{
    ocr::{self, OcrConsumerRuntimeConfig},
    postgres,
    series_analysis::{self, config::AnalysisConsumerConfig},
};
use std::{future::Future, time::Duration};
use thiserror::Error;
use tokio::{sync::watch, task::JoinHandle, time};

#[derive(Debug, Error)]
pub(crate) enum SchedulerError {
    #[error("processing scheduler database dependency failed")]
    Database(#[from] postgres::PostgresError),
    #[error("processing scheduler database transition failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("processing scheduler notification route failed")]
    Listener(#[from] listener::ListenerError),
    #[error("processing scheduler analysis failed")]
    Analysis(#[from] series_analysis::ConsumerError),
    #[error("processing scheduler analysis control failed")]
    AnalysisControl(#[from] series_analysis::control::ControlError),
    #[error("processing scheduler OCR failed")]
    Ocr(#[from] ocr::consumer::OcrConsumerError),
    #[error("processing scheduler OCR control failed")]
    OcrControl(#[from] ocr::control::OcrControlError),
    #[error("processing scheduler slot state failed")]
    Slot(#[from] crate::execution_slot::ExecutionSlotError),
    #[error("processing scheduler campaign materialization failed")]
    Materialization(#[from] series_analysis::materialization::MaterializationError),
    #[error("processing scheduler wake route closed")]
    Sink(#[from] PostCommitSinkClosed),
    #[error("processing scheduler task stopped unexpectedly")]
    Task(#[from] tokio::task::JoinError),
    #[error("processing scheduler dependency operation exceeded its deadline")]
    DependencyDeadline,
    #[error("processing scheduler requires Linux process isolation")]
    UnsupportedPlatform,
}

enum FinishedRunner {
    Analysis(series_analysis::Runner),
    Ocr(ocr::consumer::Runner),
}
mod dispatch;

type Active = JoinHandle<(FinishedRunner, Result<(), SchedulerError>)>;

struct Settings {
    database_url: String,
    listener_database_url: String,
    worker_id: String,
    recovery_interval: Duration,
    ocr_stale_after: Duration,
    operation_timeout: Duration,
}

impl From<&AnalysisConsumerConfig> for Settings {
    fn from(config: &AnalysisConsumerConfig) -> Self {
        Self {
            database_url: config.database_url.clone(),
            listener_database_url: config.listener_database_url.clone(),
            worker_id: config.worker_id.clone(),
            recovery_interval: config.recovery_interval,
            ocr_stale_after: config.ocr_stale_after,
            operation_timeout: config.execution_limits.finalization_timeout,
        }
    }
}

struct Runners {
    analysis: Option<series_analysis::Runner>,
    ocr: Option<ocr::consumer::Runner>,
    ocr_config: Option<ocr::control::OcrControlConfig>,
}

pub(crate) async fn run(
    config: AnalysisConsumerConfig,
    ocr: OcrConsumerRuntimeConfig,
    sink: PostCommitSink,
    wake: WakeReceiver,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SchedulerError> {
    let settings = Settings::from(&config);
    let analysis = series_analysis::Runner::new(config.clone(), sink.clone()).await?;
    let (ocr_config, ocr_runner) = match ocr {
        OcrConsumerRuntimeConfig::Disabled => (None, None),
        OcrConsumerRuntimeConfig::Enabled(ocr) => {
            let control = ocr.control.clone();
            let runner = ocr_runner(*ocr, &config).await?;
            (Some(control), Some(runner))
        }
    };
    Box::pin(
        Scheduler::new(
            settings,
            Some(config),
            Runners {
                analysis: Some(analysis),
                ocr: ocr_runner,
                ocr_config,
            },
            sink,
            wake,
        )
        .await?
        .run(shutdown),
    )
    .await
}

#[cfg(test)]
pub(crate) async fn run_ocr_only(
    config: ocr::consumer::OcrConsumerConfig,
    launcher: Box<dyn ocr::consumer::OcrChildLauncher>,
    sink: PostCommitSink,
    wake: WakeReceiver,
    shutdown: watch::Receiver<bool>,
) -> Result<(), SchedulerError> {
    let settings = Settings {
        database_url: config.database_url.clone(),
        listener_database_url: config.database_url.clone(),
        worker_id: config.control.worker_id().to_owned(),
        recovery_interval: Duration::from_secs(1),
        ocr_stale_after: Duration::from_secs(300),
        operation_timeout: config.shutdown_finalization_bound(),
    };
    let ocr_config = config.control.clone();
    let runner = ocr::consumer::Runner::new(config, launcher).await?;
    Box::pin(
        Scheduler::new(
            settings,
            None,
            Runners {
                analysis: None,
                ocr: Some(runner),
                ocr_config: Some(ocr_config),
            },
            sink,
            wake,
        )
        .await?
        .run(shutdown),
    )
    .await
}

#[cfg(target_os = "linux")]
async fn ocr_runner(
    config: ocr::consumer::OcrConsumerConfig,
    analysis: &AnalysisConsumerConfig,
) -> Result<ocr::consumer::Runner, SchedulerError> {
    let launcher = ocr::IsolatedOcrChildLauncher::new(
        analysis.child_cgroup.clone(),
        None,
        analysis.child_stop_grace,
        config.child_liveness_timeout(),
    );
    Ok(ocr::consumer::Runner::new(config, Box::new(launcher)).await?)
}
#[cfg(not(target_os = "linux"))]
#[expect(
    clippy::unused_async,
    reason = "the platform stub preserves the Linux async runner constructor signature"
)]
async fn ocr_runner(
    _config: ocr::consumer::OcrConsumerConfig,
    _analysis: &AnalysisConsumerConfig,
) -> Result<ocr::consumer::Runner, SchedulerError> {
    Err(SchedulerError::UnsupportedPlatform)
}

struct Scheduler {
    config: Option<AnalysisConsumerConfig>,
    settings: Settings,
    database: postgres::ConnectedClient,
    analysis: Option<series_analysis::Runner>,
    ocr: Option<ocr::consumer::Runner>,
    ocr_config: Option<ocr::control::OcrControlConfig>,
    active: Option<Active>,
    ocr_cursor: Option<selection::Cursor>,
    analysis_cursor: Option<selection::Cursor>,
    retry_after: Option<time::Instant>,
    recovery_cursor: Option<selection::RecoveryCursor>,
    sink: PostCommitSink,
    wake: WakeReceiver,
    stopped: watch::Receiver<bool>,
    stop: watch::Sender<bool>,
    listener: Option<JoinHandle<Result<(), SchedulerError>>>,
}

impl Scheduler {
    async fn new(
        settings: Settings,
        config: Option<AnalysisConsumerConfig>,
        runners: Runners,
        sink: PostCommitSink,
        wake: WakeReceiver,
    ) -> Result<Self, SchedulerError> {
        let mut listener =
            listener::subscribe(&settings.listener_database_url, sink.clone()).await?;
        let database = postgres::connect(&settings.database_url).await?;
        bounded(
            settings.operation_timeout,
            database.batch_execute("SET statement_timeout='10000ms'; SET lock_timeout='100ms'"),
        )
        .await?;
        bounded(settings.operation_timeout,database.query("SELECT input_snapshot,failure_retry_count,lease_recovery_count FROM ocr_jobs LIMIT 0", &[])).await?;
        listener.verify_notification_round_trip(&database).await?;
        tracing::info!(event="processing_jobs_notification_route_ready",worker_id=%settings.worker_id,"processing job notification route is ready");
        let (stop, stopped) = watch::channel(false);
        let listener_url = settings.listener_database_url.clone();
        let database_url = settings.database_url.clone();
        let listener_sink = sink.clone();
        let listener_stop = stopped.clone();
        let listener = tokio::spawn(async move {
            listen_reconnecting(
                listener,
                &listener_url,
                &database_url,
                listener_sink,
                listener_stop,
            )
            .await
        });
        tracing::info!(event="processing_scheduler_ready",worker_id=%settings.worker_id,"durable job scheduler is ready");
        Ok(Self {
            config,
            settings,
            database,
            analysis: runners.analysis,
            ocr: runners.ocr,
            ocr_config: runners.ocr_config,
            active: None,
            ocr_cursor: None,
            analysis_cursor: None,
            retry_after: None,
            recovery_cursor: None,
            sink,
            wake,
            stopped,
            stop,
            listener: Some(listener),
        })
    }

    async fn run(mut self, shutdown: watch::Receiver<bool>) -> Result<(), SchedulerError> {
        let result = Box::pin(self.drive(shutdown)).await;
        self.stop.send_replace(true);
        let drained = self.drain().await;
        result.and(drained)
    }

    async fn drive(&mut self, mut shutdown: watch::Receiver<bool>) -> Result<(), SchedulerError> {
        let mut maintenance_at = time::Instant::now();
        loop {
            if *shutdown.borrow() || shutdown.has_changed().is_err() {
                return Ok(());
            }
            let timeout = self.settings.operation_timeout;
            let recovered = bounded(
                timeout,
                selection::recover_page(
                    &mut self.database,
                    &self.sink,
                    self.ocr_config
                        .as_ref()
                        .map_or(1, |config| config.maximum_lease_recoveries),
                    &mut self.recovery_cursor,
                ),
            )
            .await;
            let recovered = defer_contention(recovered)?;
            let mut deferred = recovered.as_ref().is_none_or(|progress| progress.deferred);
            let recovery_pending = recovered.is_some_and(|progress| progress.more);
            let materialization_pending = if self.config.is_some() {
                let expanded = defer_contention(
                    bounded(
                        timeout,
                        series_analysis::materialization::expand_pending_campaign_targets(
                            &mut self.database,
                            64,
                        ),
                    )
                    .await,
                )?;
                let radar = defer_contention(
                    bounded(
                        timeout,
                        series_analysis::control::radar::materialize_pending(
                            &mut self.database,
                            64,
                        ),
                    )
                    .await,
                )?;
                deferred |= expanded.is_none() || radar.is_none();
                expanded == Some(64) || radar == Some(64)
            } else {
                false
            };
            if time::Instant::now() >= maintenance_at {
                if self.ocr_config.is_some() {
                    let maintenance = bounded(
                        timeout,
                        ocr::control::maintenance::reap_stale(
                            &mut self.database,
                            self.settings.ocr_stale_after,
                            timeout,
                        ),
                    )
                    .await;
                    deferred |= defer_contention(maintenance)?.is_none();
                }
                maintenance_at = time::Instant::now() + self.settings.recovery_interval;
            }
            if let Some(runner) = &mut self.analysis {
                bounded(timeout, runner.maintain()).await?;
            }
            if *shutdown.borrow() || shutdown.has_changed().is_err() {
                return Ok(());
            }
            let scan_pending = Box::pin(dispatch::claim_next(self, &shutdown)).await?;
            let mut delay = maintenance_at.saturating_duration_since(time::Instant::now());
            if let Some(runner) = &self.analysis {
                delay = delay.min(runner.maintenance_due_in());
            }
            if deferred {
                delay = delay.min(Duration::from_secs(1));
            }
            if let Some(retry) = self.retry_after {
                delay = delay.min(retry.saturating_duration_since(time::Instant::now()));
            }
            if scan_pending || materialization_pending || recovery_pending {
                delay = Duration::ZERO;
            }
            delay = bounded(
                timeout,
                selection::next_due(&self.database, self.ocr_config.is_some(), delay),
            )
            .await?;
            tokio::select! {
                changed = shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { return Ok(()); } }
                result = async { match &mut self.listener {Some(listener)=>listener.await,None=>std::future::pending().await} } => { self.listener=None; result??; return Err(SchedulerError::Sink(PostCommitSinkClosed)); }
                result = async { match &mut self.active { Some(active) => active.await, None => std::future::pending().await } } => { self.active = None; self.retry_after=None; let (runner,result) = result?; self.restore(runner); result?; }
                hint = self.wake.recv() => { hint.ok_or(PostCommitSinkClosed)?; }
                () = time::sleep(delay) => {}
            }
        }
    }

    fn restore(&mut self, runner: FinishedRunner) {
        match runner {
            FinishedRunner::Analysis(runner) => self.analysis = Some(runner),
            FinishedRunner::Ocr(runner) => self.ocr = Some(runner),
        }
    }
    async fn drain(&mut self) -> Result<(), SchedulerError> {
        let mut result = Ok(());
        if let Some(active) = self.active.take() {
            match active.await {
                Ok((runner, finished)) => {
                    self.restore(runner);
                    result = finished;
                }
                Err(error) => result = Err(error.into()),
            }
        }
        if let Some(analysis) = self.analysis.take() {
            result = result.and(analysis.drain().await.map_err(SchedulerError::from));
        }
        if let Some(listener) = self.listener.take() {
            result = result.and(listener.await?);
        }
        result
    }
}

async fn listen_reconnecting(
    mut listener: listener::Listener,
    listener_url: &str,
    database_url: &str,
    sink: PostCommitSink,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), SchedulerError> {
    loop {
        match listener.run(shutdown.clone()).await {
            Ok(()) => return Ok(()),
            Err(
                error @ (listener::ListenerError::InvalidNotification
                | listener::ListenerError::SinkClosed(_)
                | listener::ListenerError::ShutdownChannelClosed),
            ) => return Err(error.into()),
            Err(error) => tracing::warn!(
                event = "processing_jobs_listener_reconnecting",
                error_kind = error.kind(),
                "notification connection will reconnect while durable deadline recovery continues"
            ),
        }
        loop {
            tokio::select! { changed=shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { return Ok(()); } }, ()=time::sleep(Duration::from_secs(1))=>{} }
            if let Ok(mut connected) = listener::subscribe(listener_url, sink.clone()).await {
                let Ok(publisher) = postgres::connect(database_url).await else {
                    continue;
                };
                match connected.verify_notification_round_trip(&publisher).await {
                    Ok(()) => {
                        listener = connected;
                        break;
                    }
                    Err(
                        error @ (listener::ListenerError::InvalidNotification
                        | listener::ListenerError::SinkClosed(_)
                        | listener::ListenerError::ShutdownChannelClosed),
                    ) => return Err(error.into()),
                    Err(_) => {}
                }
            }
        }
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        self.stop.send_replace(true);
        if let Some(active) = &self.active {
            active.abort();
        }
        if let Some(listener) = &self.listener {
            listener.abort();
        }
    }
}

async fn bounded<T, E: Into<SchedulerError>>(
    timeout: Duration,
    operation: impl Future<Output = Result<T, E>>,
) -> Result<T, SchedulerError> {
    time::timeout(timeout, operation)
        .await
        .map_err(|_elapsed| SchedulerError::DependencyDeadline)?
        .map_err(Into::into)
}

fn defer_contention<T>(result: Result<T, SchedulerError>) -> Result<Option<T>, SchedulerError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.is_contention() => Ok(None),
        Err(error) => Err(error),
    }
}

impl SchedulerError {
    pub(super) fn is_contention(&self) -> bool {
        match self {
            Self::Postgres(error)
            | Self::Slot(crate::execution_slot::ExecutionSlotError::Postgres(error))
            | Self::Materialization(
                series_analysis::materialization::MaterializationError::Postgres(error),
            ) => postgres::is_lock_contention(error),
            Self::OcrControl(error) => error.is_contention(),
            Self::AnalysisControl(error) => error.is_contention(),
            Self::Database(_)
            | Self::Listener(_)
            | Self::Analysis(_)
            | Self::Ocr(_)
            | Self::Slot(_)
            | Self::Materialization(_)
            | Self::Sink(_)
            | Self::Task(_)
            | Self::DependencyDeadline
            | Self::UnsupportedPlatform => false,
        }
    }
}
