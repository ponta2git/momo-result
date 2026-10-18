use super::{
    PostCommitSink, PostCommitSinkClosed, WakeReceiver, listener,
    plan::{EnabledConsumers, WorkerRuntimePlan},
    selection,
};
use crate::{
    execution::ExecutionHandle,
    maintenance::drain::{Control, FailureKind, InFlight},
    notifications::{NotificationDriver, NotificationHandle},
    ocr::{self, OcrConsumerRuntimeConfig},
    postgres,
    resource_budget::{ResourceBudget, ResourceBudgetError, ResourceLimits},
    series_analysis::{self, config::AnalysisConsumerConfig},
};
use futures_util::FutureExt;
use std::{future::Future, panic::AssertUnwindSafe, time::Duration};
use thiserror::Error;
use tokio::{sync::watch, time};

#[derive(Debug, Error)]
pub(crate) enum WorkerError {
    #[error(transparent)]
    Resources(#[from] ResourceBudgetError),
    #[error(transparent)]
    MaintenanceScope(#[from] crate::maintenance::analysis::ScopeError),
    #[error("processing worker database dependency failed")]
    Database(#[from] postgres::PostgresError),
    #[error("processing worker database transition failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("processing worker notification route failed")]
    Listener(#[from] listener::ListenerError),
    #[error("processing worker analysis failed")]
    Analysis(#[from] series_analysis::ConsumerError),
    #[error("processing worker analysis control failed")]
    AnalysisControl(#[from] series_analysis::control::ControlError),
    #[error("processing worker OCR failed")]
    Ocr(#[from] ocr::consumer::OcrConsumerError),
    #[error("processing worker OCR control failed")]
    OcrControl(#[from] ocr::control::OcrControlError),
    #[error("processing worker slot state failed")]
    Slot(#[from] crate::execution_slot::ExecutionSlotError),
    #[error("processing worker campaign materialization failed")]
    Materialization(#[from] series_analysis::materialization::MaterializationError),
    #[error("processing worker wake route closed")]
    Sink(#[from] PostCommitSinkClosed),
    #[error("processing worker task stopped unexpectedly")]
    Task(#[from] tokio::task::JoinError),
    #[error("processing worker dependency operation exceeded its deadline")]
    DependencyDeadline,
    #[error(transparent)]
    NotificationConfiguration(#[from] crate::notifications::NotificationConfigError),
    #[error(transparent)]
    SeriesAnalysisConfiguration(#[from] series_analysis::config::AnalysisConfigError),
    #[error(transparent)]
    OcrConfiguration(#[from] ocr::OcrRuntimeConfigError),
    #[error("OCR requires the analysis runtime")]
    OcrRequiresSeriesAnalysisRuntime,
    #[error("worker shutdown budget exceeds supported bounds")]
    ShutdownDrainBudgetBound,
    #[error("worker shutdown exceeded its deadline")]
    ShutdownDrainTimeout,
    #[error("worker operation panicked")]
    Panicked,
    #[error("worker task exited unexpectedly")]
    UnexpectedExit,
    #[error("worker task cleanup failed")]
    CleanupFailed,
    #[error(transparent)]
    Execution(#[from] crate::execution::ExecutionError),
    #[error(transparent)]
    OcrBootstrap(#[from] ocr::bootstrap::BootstrapError),
    #[error(transparent)]
    OcrSubmissions(#[from] ocr::submissions::runtime::RuntimeError),
    #[error("processing worker requires Linux process isolation")]
    UnsupportedPlatform,
}

struct Settings {
    resource_limits: ResourceLimits,
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
            resource_limits: ResourceLimits {
                cpu: config.child_cgroup.cpu_budget(),
                memory: config.execution_limits.memory,
            },
            database_url: config.database_url.clone(),
            listener_database_url: config.listener_database_url.clone(),
            worker_id: config.worker_id.clone(),
            recovery_interval: config.recovery_interval,
            ocr_stale_after: config.ocr_stale_after,
            operation_timeout: config.execution_limits.finalization_timeout,
        }
    }
}

enum FinishedRunner {
    Analysis(series_analysis::Runner),
    Ocr(ocr::orchestrator::ImageRunner),
}

enum PendingExecution {
    Analysis(
        series_analysis::Runner,
        series_analysis::control::ClaimedJob,
    ),
    Ocr(ocr::orchestrator::ImageRunner, ocr::control::ClaimedOcrJob),
}
mod dispatch;
pub(crate) mod maintenance;

struct WorkState {
    config: Option<AnalysisConsumerConfig>,
    settings: Settings,
    database: postgres::ConnectedClient,
    analysis: Option<series_analysis::Module>,
    ocr: Option<ocr::orchestrator::ImageRunner>,
    ocr_config: Option<ocr::control::OcrControlConfig>,
    resources: ResourceBudget,
    pending: Option<PendingExecution>,
    ocr_cursor: Option<selection::Cursor>,
    analysis_cursor: Option<selection::Cursor>,
    retry_after: Option<time::Instant>,
    recovery_cursor: Option<selection::RecoveryCursor>,
    sink: PostCommitSink,
    maintenance_at: time::Instant,
}

impl WorkState {
    fn new(
        settings: Settings,
        config: Option<AnalysisConsumerConfig>,
        database: postgres::ConnectedClient,
        sink: PostCommitSink,
    ) -> Self {
        let resources = ResourceBudget::new(settings.resource_limits);
        Self {
            config,
            settings,
            database,
            analysis: None,
            ocr: None,
            ocr_config: None,
            resources,
            pending: None,
            ocr_cursor: None,
            analysis_cursor: None,
            retry_after: None,
            recovery_cursor: None,
            sink,
            maintenance_at: time::Instant::now(),
        }
    }
    fn restore(&mut self, runner: FinishedRunner) {
        self.resources.release();
        self.retry_after = None;
        match runner {
            FinishedRunner::Analysis(runner) => {
                if let Some(module) = &mut self.analysis {
                    module.restore_runner(runner);
                }
            }
            FinishedRunner::Ocr(runner) => self.ocr = Some(runner),
        }
    }
    async fn step(&mut self, shutdown: &watch::Receiver<bool>) -> Result<Duration, WorkerError> {
        if dispatch::stopping(shutdown) {
            return Ok(Duration::ZERO);
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
        if dispatch::stopping(shutdown) {
            return Ok(Duration::ZERO);
        }
        let (materialization_pending, materialization_deferred) =
            self.materialize(shutdown).await?;
        deferred |= materialization_deferred;
        if dispatch::stopping(shutdown) {
            return Ok(Duration::ZERO);
        }
        if time::Instant::now() >= self.maintenance_at {
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
            self.maintenance_at = time::Instant::now() + self.settings.recovery_interval;
        }
        if dispatch::stopping(shutdown) {
            return Ok(Duration::ZERO);
        }
        if let Some(runner) = &mut self.analysis {
            bounded(timeout, runner.maintain()).await?;
        }
        if *shutdown.borrow() || shutdown.has_changed().is_err() {
            return Ok(Duration::ZERO);
        }
        let scan_pending = Box::pin(dispatch::claim_next(self, shutdown)).await?;
        if self.pending.is_some() {
            return Ok(Duration::ZERO);
        }
        let mut delay = self
            .maintenance_at
            .saturating_duration_since(time::Instant::now());
        if let Some(runner) = &self.analysis {
            delay = delay.min(runner.maintenance_due_in().unwrap_or(delay));
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
        Ok(delay)
    }
    async fn materialize(
        &mut self,
        shutdown: &watch::Receiver<bool>,
    ) -> Result<(bool, bool), WorkerError> {
        if self.config.is_none() {
            return Ok((false, false));
        }
        let timeout = self.settings.operation_timeout;
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
        if dispatch::stopping(shutdown) {
            return Ok((false, false));
        }
        let radar = defer_contention(
            bounded(
                timeout,
                series_analysis::control::radar::materialize_pending(&mut self.database, 64),
            )
            .await,
        )?;
        Ok((
            expanded == Some(64) || radar == Some(64),
            expanded.is_none() || radar.is_none(),
        ))
    }
}

async fn listen_reconnecting(
    mut listener: listener::Listener,
    listener_url: &str,
    database_url: &str,
    sink: PostCommitSink,
    mut shutdown: watch::Receiver<bool>,
    submissions_enabled: bool,
) -> Result<(), WorkerError> {
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
            let reconnect = async {
                let mut connected =
                    listener::subscribe_routes(listener_url, sink.clone(), submissions_enabled)
                        .await?;
                let publisher = postgres::connect(database_url).await?;
                connected.verify_notification_round_trip(&publisher).await?;
                Ok::<_, WorkerError>(connected)
            };
            tokio::select! {
                changed=shutdown.changed()=>{if changed.is_err() || *shutdown.borrow(){return Ok(());}}
                result=reconnect=>match result {
                    Ok(connected)=>{listener=connected;break;}
                    Err(error @ WorkerError::Listener(listener::ListenerError::InvalidNotification | listener::ListenerError::SinkClosed(_) | listener::ListenerError::ShutdownChannelClosed))=>return Err(error),
                    Err(_transient)=>{}
                }
            }
        }
    }
}

async fn bounded<T, E: Into<WorkerError>>(
    timeout: Duration,
    operation: impl Future<Output = Result<T, E>>,
) -> Result<T, WorkerError> {
    time::timeout(timeout, operation)
        .await
        .map_err(|_elapsed| WorkerError::DependencyDeadline)?
        .map_err(Into::into)
}

fn defer_contention<T>(result: Result<T, WorkerError>) -> Result<Option<T>, WorkerError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.is_contention() => Ok(None),
        Err(error) => Err(error),
    }
}

impl WorkerError {
    pub(super) fn is_contention(&self) -> bool {
        match self {
            Self::Postgres(error)
            | Self::Slot(crate::execution_slot::ExecutionSlotError::Postgres(error))
            | Self::Materialization(
                series_analysis::materialization::MaterializationError::Postgres(error),
            ) => postgres::is_lock_contention(error),
            Self::OcrControl(error) => error.is_contention(),
            Self::AnalysisControl(error) => error.is_contention(),
            Self::MaintenanceScope(_)
            | Self::Resources(_)
            | Self::Database(_)
            | Self::Listener(_)
            | Self::Analysis(_)
            | Self::Ocr(_)
            | Self::Slot(_)
            | Self::Materialization(_)
            | Self::Sink(_)
            | Self::Task(_)
            | Self::DependencyDeadline
            | Self::NotificationConfiguration(_)
            | Self::SeriesAnalysisConfiguration(_)
            | Self::OcrConfiguration(_)
            | Self::OcrRequiresSeriesAnalysisRuntime
            | Self::ShutdownDrainBudgetBound
            | Self::ShutdownDrainTimeout
            | Self::Panicked
            | Self::UnexpectedExit
            | Self::CleanupFailed
            | Self::Execution(_)
            | Self::OcrBootstrap(_)
            | Self::OcrSubmissions(_)
            | Self::UnsupportedPlatform => false,
        }
    }
}

type Attempt = (FinishedRunner, Result<(), WorkerError>);
type Reconciliation = (
    ocr::submissions::runtime::Reconciler,
    Result<(), WorkerError>,
);

#[derive(Clone, Copy, Eq, PartialEq)]
enum Observation {
    Operation,
    Idle,
    Drain,
    Cleanup,
}

/// The sole lifecycle owner. In-flight operations borrow business state, never these handles.
struct Runtime {
    external: watch::Receiver<bool>,
    stop: watch::Sender<bool>,
    stopped: watch::Receiver<bool>,
    admission_stop: watch::Sender<bool>,
    admission_stopped: watch::Receiver<bool>,
    maintenance: Option<Control>,
    advertise_capability: bool,
    timeout: Duration,
    cleanup_grace: Duration,
    deadline: Option<time::Instant>,
    failure: Option<WorkerError>,
    listener: Option<ExecutionHandle<Result<(), WorkerError>>>,
    active: Option<ExecutionHandle<Attempt>>,
    reconcile: Option<ExecutionHandle<Reconciliation>>,
    returned: Option<FinishedRunner>,
    submissions: Option<ocr::submissions::runtime::Reconciler>,
    submissions_dirty: bool,
    notifications: Option<NotificationHandle>,
    wake: Option<WakeReceiver>,
}

impl Runtime {
    fn new(external: watch::Receiver<bool>, timeout: Duration, cleanup_grace: Duration) -> Self {
        let (stop, stopped) = watch::channel(false);
        let (admission_stop, admission_stopped) = watch::channel(false);
        Self {
            external,
            stop,
            stopped,
            admission_stop,
            admission_stopped,
            maintenance: None,
            advertise_capability: true,
            timeout,
            cleanup_grace,
            deadline: None,
            failure: None,
            listener: None,
            active: None,
            reconcile: None,
            returned: None,
            submissions: None,
            submissions_dirty: false,
            notifications: None,
            wake: None,
        }
    }
    const fn stopping(&self) -> bool {
        self.deadline.is_some()
    }
    fn graceful_deadline(&self) -> Option<time::Instant> {
        self.deadline
            .map(|deadline| deadline.checked_sub(self.cleanup_grace).unwrap_or(deadline))
    }
    fn request_stop(&mut self) {
        if self.deadline.is_none() {
            self.deadline = time::Instant::now().checked_add(self.timeout);
            if self.deadline.is_none() {
                self.deadline = Some(time::Instant::now());
                self.failure
                    .get_or_insert(WorkerError::ShutdownDrainBudgetBound);
            }
        }
        self.stop.send_replace(true);
        self.admission_stop.send_replace(true);
    }
    fn fail(&mut self, error: WorkerError) {
        if self.failure.is_none() {
            self.failure = Some(error);
        }
        self.request_stop();
    }

    /// A stop retains the operation until it finishes or the common shutdown deadline expires.
    /// After unwind, borrowed business state is only drained/dropped, never resumed.
    async fn observe<T: Send>(
        &mut self,
        operation: impl Future<Output = Result<T, WorkerError>> + Send,
        observation: Observation,
    ) -> Result<Option<T>, WorkerError> {
        self.report_progress(
            observation == Observation::Operation || observation == Observation::Cleanup,
        );
        let result = Box::pin(self.observe_inner(operation, observation)).await;
        self.report_progress(false);
        result
    }

    fn report_progress(&self, operation: bool) {
        if let Some(control) = &self.maintenance {
            control.counts(InFlight {
                operations: u8::from(operation),
                attempts: u8::from(self.active.is_some()),
                reconciliations: u8::from(self.reconcile.is_some()),
            });
        }
    }

    async fn observe_inner<T: Send>(
        &mut self,
        operation: impl Future<Output = Result<T, WorkerError>> + Send,
        observation: Observation,
    ) -> Result<Option<T>, WorkerError> {
        let guarded = AssertUnwindSafe(operation).catch_unwind();
        tokio::pin!(guarded);
        let mut admission = self.maintenance.as_ref().map(Control::admission_receiver);
        let mut all = self.maintenance.as_ref().map(Control::all_receiver);
        loop {
            if self
                .maintenance
                .as_ref()
                .is_some_and(Control::admission_closed)
            {
                self.admission_stop.send_replace(true);
            }
            if *self.external.borrow()
                || self.external.has_changed().is_err()
                || *self.stopped.borrow()
                || self
                    .maintenance
                    .as_ref()
                    .is_some_and(Control::all_requested)
            {
                self.request_stop();
            }
            if observation == Observation::Idle && self.stopping() {
                return Ok(None);
            }
            self.start_reconciliation();
            let deadline = if observation == Observation::Cleanup {
                self.deadline
            } else {
                self.graceful_deadline()
            };
            tokio::select! {
                biased;
                () = async { match deadline { Some(deadline) => time::sleep_until(deadline).await, None => std::future::pending().await } } => return Err(WorkerError::ShutdownDrainTimeout),
                changed = self.external.changed(), if !self.stopping() => {
                    if changed.is_err() || *self.external.borrow() { self.request_stop(); }
                }
                changed = self.stopped.changed(), if !self.stopping() => {
                    if changed.is_err() || *self.stopped.borrow() { self.request_stop(); }
                }
                _changed = async { match &mut admission { Some(receiver) => receiver.changed().await, None => std::future::pending().await } }, if !*self.admission_stopped.borrow() => {
                    self.admission_stop.send_replace(true);
                    if observation == Observation::Idle { return Ok(None); }
                }
                _changed = async { match &mut all { Some(receiver) => receiver.changed().await, None => std::future::pending().await } }, if !self.stopping() => self.request_stop(),
                result = async { match &mut self.listener { Some(handle)=>handle.completed().await, None=>std::future::pending().await } } => {
                    self.listener = None;
                    match result {
                        Ok(Ok(())) if self.stopping() => {}
                        Ok(Ok(())) => self.fail(WorkerError::UnexpectedExit),
                        Ok(Err(error)) => self.fail(error),
                        Err(error) => self.fail(error.into()),
                    }
                    if matches!(observation,Observation::Idle|Observation::Drain) { return Ok(None); }
                }
                result = async { match &mut self.active { Some(handle)=>handle.completed().await, None=>std::future::pending().await } } => {
                    let clean = self.active.as_ref().is_none_or(|handle| matches!(handle.cleanup_state(), crate::execution::CleanupState::Clean));
                    self.active = None;
                    match result {
                        Ok((runner, result)) => {
                            if clean { self.returned=Some(runner); }
                            if let Err(error)=result { self.fail(error); }
                        }
                        Err(error) => self.fail(error.into()),
                    }
                    if !clean { self.fail(WorkerError::CleanupFailed); }
                    if matches!(observation,Observation::Idle|Observation::Drain) { return Ok(None); }
                }
                result = async { match &mut self.reconcile { Some(handle)=>handle.completed().await, None=>std::future::pending().await } } => {
                    self.reconcile = None;
                    match result {
                        Ok((state, result)) => { self.submissions=Some(state); if let Err(error)=result { self.fail(error); } }
                        Err(error) => self.fail(error.into()),
                    }
                    if matches!(observation,Observation::Idle|Observation::Drain) { return Ok(None); }
                }
                () = async { match &mut self.notifications { Some(handle)=>handle.completed().await, None=>std::future::pending().await } } => {}
                result = &mut guarded => return match result { Ok(result)=>result.map(Some), Err(_panic)=>Err(WorkerError::Panicked) },
                hint=async {match &mut self.wake {Some(wake)=>wake.recv().await,None=>std::future::pending().await}}=>{
                    if hint.is_none() {self.wake=None;self.fail(PostCommitSinkClosed.into());}
                    self.submissions_dirty=true;
                    if observation==Observation::Idle {return Ok(None);}
                }
                ()=async {match &self.submissions {Some(state)=>time::sleep_until(state.next_at()).await,None=>std::future::pending().await}}, if !self.stopping() && !*self.admission_stopped.borrow() && self.reconcile.is_none()=>{}

            }
        }
    }

    async fn operation<T: Send>(
        &mut self,
        operation: impl Future<Output = Result<T, WorkerError>> + Send,
    ) -> Result<T, WorkerError> {
        self.observe(operation, Observation::Operation)
            .await?
            .ok_or(WorkerError::ShutdownDrainTimeout)
    }

    fn start_attempt(&mut self, pending: PendingExecution) {
        let stopped = self.stopped.clone();
        let stop = self.stop.clone();
        self.active = Some(match pending {
            PendingExecution::Analysis(mut runner, claim) => {
                ExecutionHandle::spawn(self.stop.clone(), self.cleanup_grace, async move {
                    let result = runner
                        .execute(claim, stopped)
                        .await
                        .map_err(WorkerError::from);
                    if result.is_err() {
                        stop.send_replace(true);
                    }
                    (FinishedRunner::Analysis(runner), result)
                })
            }
            PendingExecution::Ocr(mut runner, claim) => {
                ExecutionHandle::spawn(self.stop.clone(), self.cleanup_grace, async move {
                    let result = runner
                        .execute(claim, stopped)
                        .await
                        .map_err(WorkerError::from);
                    if result.is_err() {
                        stop.send_replace(true);
                    }
                    (FinishedRunner::Ocr(runner), result)
                })
            }
        });
    }
    fn start_reconciliation(&mut self) {
        if self.stopping() || *self.admission_stopped.borrow() || self.reconcile.is_some() {
            return;
        }
        if let Some(state) = &mut self.submissions {
            if self.submissions_dirty {
                state.request_scan();
                self.submissions_dirty = false;
            }
            if state.next_at() > time::Instant::now() {
                return;
            }
        }
        if let Some(mut state) = self.submissions.take() {
            let stopped = self.stopped.clone();
            let stop = self.stop.clone();
            self.reconcile = Some(ExecutionHandle::spawn(
                self.stop.clone(),
                self.cleanup_grace,
                async move {
                    let result = state.step(&stopped).await.map_err(WorkerError::from);
                    if result.is_err() {
                        stop.send_replace(true);
                    }
                    (state, result)
                },
            ));
        }
    }

    async fn drain_tasks(&mut self) {
        while self.active.is_some() || self.reconcile.is_some() || self.listener.is_some() {
            if let Err(error) = self
                .observe(
                    std::future::pending::<Result<(), WorkerError>>(),
                    Observation::Drain,
                )
                .await
            {
                self.fail(error);
                break;
            }
        }
        if let Some(deadline) = self.deadline {
            if let Some(mut handle) = self.active.take()
                && let Err(error) = handle.abort_and_cleanup(deadline).await
            {
                self.fail(error.into());
            }
            if let Some(mut handle) = self.reconcile.take()
                && let Err(error) = handle.abort_and_cleanup(deadline).await
            {
                self.fail(error.into());
            }
            if let Some(mut handle) = self.listener.take()
                && let Err(error) = handle.abort_and_cleanup(deadline).await
            {
                self.fail(error.into());
            }
        }
    }
}

pub(crate) async fn run(
    plan: WorkerRuntimePlan,
    mut external: watch::Receiver<bool>,
    shutdown_deadline: &mut Option<time::Instant>,
    maintenance: Option<Control>,
) -> Result<(), WorkerError> {
    let Some(enabled) = plan.enabled_consumers else {
        if let Some(control) = maintenance {
            let mut admission = control.admission_receiver();
            let mut all = control.all_receiver();
            loop {
                if control.admission_closed() {
                    control.admission_settled();
                }
                if control.all_requested() {
                    control.runtime_settled(Ok(()));
                    return Ok(());
                }
                if *external.borrow() {
                    return Ok(());
                }
                tokio::select! {
                    changed = external.changed() => if changed.is_err() { return Ok(()); },
                    _changed = admission.changed(), if !control.admission_closed() => {},
                    _changed = all.changed() => {},
                }
            }
        }
        while !*external.borrow() {
            if external.changed().await.is_err() {
                break;
            }
        }
        return Ok(());
    };
    let mut runtime = Runtime::new(
        external,
        enabled.shutdown_drain_timeout,
        enabled.series_analysis.child_stop_grace,
    );
    runtime.maintenance = maintenance;
    let (sink, wake) = PostCommitSink::channel();
    runtime.wake = Some(wake);
    let mut state = None;
    let initialized = Box::pin(
        AssertUnwindSafe(bootstrap(&mut runtime, &mut state, enabled, sink)).catch_unwind(),
    )
    .await;
    match initialized {
        Ok(Ok(())) => {}
        Ok(Err(error)) => runtime.fail(error),
        Err(_panic) => runtime.fail(WorkerError::Panicked),
    }
    if !runtime.stopping() {
        let outcome = AssertUnwindSafe(drive(&mut runtime, &mut state))
            .catch_unwind()
            .await;
        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(error)) => runtime.fail(error),
            Err(_panic) => runtime.fail(WorkerError::Panicked),
        }
    }
    let mut result = finish(&mut runtime, &mut state).await;
    if let Some(control) = &runtime.maintenance {
        if let Some(deadline) = runtime.deadline
            && !postgres::settle_drivers(deadline).await
            && result.is_ok()
        {
            result = Err(WorkerError::ShutdownDrainTimeout);
        }
        if result.is_ok() {
            control.counts(InFlight::default());
        }
        control.runtime_settled(result.as_ref().copied().map_err(|error| {
            if matches!(error, WorkerError::ShutdownDrainTimeout) {
                FailureKind::TimedOut
            } else {
                FailureKind::Failed
            }
        }));
    }
    *shutdown_deadline = runtime.deadline;
    result
}

async fn finish(runtime: &mut Runtime, state: &mut Option<WorkState>) -> Result<(), WorkerError> {
    runtime.request_stop();
    if let Some(work) = state.as_mut()
        && let Some(pending) = work.pending.take()
    {
        runtime.start_attempt(pending);
    }
    runtime.drain_tasks().await;
    if let Some(work) = state {
        if let Some(runner) = runtime.returned.take() {
            work.restore(runner);
        }
        if let Some(analysis) = &mut work.analysis
            && runtime.advertise_capability
        {
            if let Err(error) = runtime
                .observe(
                    async {
                        analysis
                            .drain(&work.database)
                            .await
                            .map_err(WorkerError::from)
                    },
                    Observation::Cleanup,
                )
                .await
            {
                runtime.fail(error);
            }
        } else if let Some(config) = &work.config
            && runtime.advertise_capability
        {
            // Registration can have committed before a lost startup response. The worker ID
            // survives the startup unwind, so cleanup does not require the module to return.
            if let Err(error) = runtime
                .observe(
                    bounded(
                        config.control_response_timeout(),
                        series_analysis::control::mark_draining(&work.database, &config.worker_id),
                    ),
                    Observation::Cleanup,
                )
                .await
            {
                runtime.fail(error);
            }
        }
    }
    // Release every business producer only after its final commit and capability drain.
    drop(state.take());
    runtime.submissions = None;
    runtime.returned = None;

    let graceful_until = runtime.graceful_deadline();
    if let (Some(sender), Some(graceful_until), Some(deadline)) =
        (&mut runtime.notifications, graceful_until, runtime.deadline)
    {
        sender.drain_until(graceful_until, deadline).await;
        if runtime.maintenance.is_some() && !sender.is_settled() {
            runtime.fail(WorkerError::ShutdownDrainTimeout);
        }
    }
    runtime.failure.take().map_or(Ok(()), Err)
}

async fn bootstrap(
    runtime: &mut Runtime,
    state: &mut Option<WorkState>,
    enabled: EnabledConsumers,
    sink: PostCommitSink,
) -> Result<(), WorkerError> {
    let EnabledConsumers {
        notifications,
        series_analysis: config,
        ocr,
        ..
    } = enabled;
    preflight(&config)?;
    let (notification_sink, driver) = NotificationDriver::new(notifications)?;
    runtime.notifications = Some(driver.spawn());
    let config = config.with_notifications(notification_sink.clone());
    let settings = Settings::from(&config);
    let submissions_enabled = matches!(ocr, OcrConsumerRuntimeConfig::Enabled(_));
    let database = runtime
        .operation(async { Ok(postgres::connect(&settings.database_url).await?) })
        .await?;
    if runtime.stopping() {
        return Ok(());
    }
    let mut listener = runtime
        .operation(async {
            Ok(listener::subscribe_routes(
                &settings.listener_database_url,
                sink.clone(),
                submissions_enabled,
            )
            .await?)
        })
        .await?;
    if runtime.stopping() {
        return Ok(());
    }
    runtime.operation(async {
        bounded(settings.operation_timeout,database.batch_execute("SET statement_timeout='10000ms'; SET lock_timeout='100ms'")).await?;
        bounded(settings.operation_timeout,database.query("SELECT input_snapshot,failure_retry_count,lease_recovery_count FROM ocr_jobs LIMIT 0",&[])).await?;
        listener.verify_notification_round_trip(&database).await?;Ok(())
    }).await?;
    // Keep the deployment readiness event contract stable across module ownership changes.
    tracing::info!(event="processing_jobs_notification_route_ready",worker_id=%settings.worker_id,"all enabled notification routes are ready");
    let listener_url = settings.listener_database_url.clone();
    let database_url = settings.database_url.clone();
    let listener_sink = sink.clone();
    let stopped = runtime.stopped.clone();
    runtime.listener = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            listen_reconnecting(
                listener,
                &listener_url,
                &database_url,
                listener_sink,
                stopped,
                submissions_enabled,
            )
            .await
        },
    ));
    *state = Some(WorkState::new(
        settings,
        Some(config.clone()),
        database,
        sink.clone(),
    ));
    let work = state.as_mut().ok_or(WorkerError::UnexpectedExit)?;
    if runtime.stopping() {
        return Ok(());
    }
    work.analysis = Some(
        runtime
            .operation(async {
                Ok(series_analysis::bootstrap::initialize(config.clone(), sink).await?)
            })
            .await?,
    );
    if runtime.stopping() {
        return Ok(());
    }
    if let OcrConsumerRuntimeConfig::Enabled(ocr) = ocr {
        work.ocr_config = Some(ocr.control.clone());
        let ocr::bootstrap::Bootstrapped {
            images,
            submissions,
        } = Box::pin(runtime.operation(async {
            Ok(ocr::bootstrap::initialize(*ocr, &config, notification_sink).await?)
        }))
        .await?;
        work.ocr = Some(images);
        runtime.submissions = Some(submissions);
    }
    drop(config);
    tracing::info!(event="processing_scheduler_ready",worker_id=%work.settings.worker_id,"durable processing runtime is ready");
    Ok(())
}

async fn drive(runtime: &mut Runtime, state: &mut Option<WorkState>) -> Result<(), WorkerError> {
    if let Some(work) = state {
        while !runtime.stopping() {
            if let Some(runner) = runtime.returned.take() {
                work.restore(runner);
            }
            if runtime
                .maintenance
                .as_ref()
                .is_some_and(Control::admission_closed)
            {
                runtime.admission_stop.send_replace(true);
            }
            if *runtime.admission_stopped.borrow() {
                runtime.report_progress(false);
                if runtime.active.is_none()
                    && runtime.reconcile.is_none()
                    && let Some(control) = &runtime.maintenance
                {
                    control.admission_settled();
                }
                runtime
                    .observe(
                        std::future::pending::<Result<(), WorkerError>>(),
                        Observation::Idle,
                    )
                    .await?;
                continue;
            }
            runtime.start_reconciliation();
            let stopped = runtime.admission_stopped.clone();
            let step = runtime.operation(Box::pin(work.step(&stopped))).await;
            // A claim that committed while stop arrived still needs typed durable finalization.
            if let Some(pending) = work.pending.take() {
                runtime.start_attempt(pending);
            }
            let delay = match step {
                Ok(delay) => delay,
                Err(error) => {
                    runtime.fail(error);
                    break;
                }
            };
            let mut delay = if runtime.returned.is_some() {
                Duration::ZERO
            } else {
                delay
            };
            if let Some(submissions) = &runtime.submissions {
                delay = delay.min(
                    submissions
                        .next_at()
                        .saturating_duration_since(time::Instant::now()),
                );
            }
            if let Err(error) = runtime
                .observe(
                    async {
                        time::sleep(delay).await;
                        Ok(())
                    },
                    Observation::Idle,
                )
                .await
            {
                runtime.fail(error);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) async fn run_ocr_only(
    config: ocr::consumer::OcrConsumerConfig,
    launcher: Box<dyn ocr::consumer::OcrChildLauncher>,
    sink: PostCommitSink,
    wake: WakeReceiver,
    external: watch::Receiver<bool>,
) -> Result<(), WorkerError> {
    let bound = config.shutdown_finalization_bound();
    let settings = Settings {
        resource_limits: ResourceLimits::fixture(),
        database_url: config.database_url.clone(),
        listener_database_url: config.database_url.clone(),
        worker_id: config.control.worker_id().to_owned(),
        recovery_interval: Duration::from_secs(1),
        ocr_stale_after: Duration::from_secs(300),
        operation_timeout: bound,
    };
    let mut runtime = Runtime::new(
        external,
        bound + Duration::from_secs(10),
        Duration::from_secs(1),
    );
    runtime.wake = Some(wake);
    let database = postgres::connect(&settings.database_url).await?;
    database
        .batch_execute("SET statement_timeout='10000ms'; SET lock_timeout='100ms'")
        .await?;
    let mut listener =
        listener::subscribe_routes(&settings.listener_database_url, sink.clone(), false).await?;
    listener.verify_notification_round_trip(&database).await?;
    let listener_sink = sink.clone();
    let listener_url = settings.listener_database_url.clone();
    let database_url = settings.database_url.clone();
    let stopped = runtime.stopped.clone();
    runtime.listener = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            listen_reconnecting(
                listener,
                &listener_url,
                &database_url,
                listener_sink,
                stopped,
                false,
            )
            .await
        },
    ));
    let ocr_config = Some(config.control.clone());
    let ocr = Some(ocr::orchestrator::ImageRunner::new(config, launcher).await?);
    let resources = ResourceBudget::new(settings.resource_limits);
    let mut state = Some(WorkState {
        config: None,
        settings,
        database,
        analysis: None,
        ocr,
        ocr_config,
        resources,
        pending: None,
        ocr_cursor: None,
        analysis_cursor: None,
        retry_after: None,
        recovery_cursor: None,
        sink,
        maintenance_at: time::Instant::now(),
    });
    let result = AssertUnwindSafe(drive(&mut runtime, &mut state))
        .catch_unwind()
        .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => runtime.fail(error),
        Err(_panic) => runtime.fail(WorkerError::Panicked),
    }
    let shutdown_result = finish(&mut runtime, &mut state).await;
    drop(runtime);
    shutdown_result
}

#[cfg(test)]
mod reconciliation_tests;
#[cfg(test)]
mod tests;

fn preflight(config: &AnalysisConsumerConfig) -> Result<(), WorkerError> {
    // Common process prerequisites are checked once, before any capability is advertised.
    if !crate::process::managed_child_runtime_supported() {
        return Err(series_analysis::ConsumerError::Process(
            crate::process::ProcessError::UnsupportedPlatform,
        )
        .into());
    }
    if !crate::process::worker_identity_supported() {
        return Err(series_analysis::ConsumerError::Process(
            crate::process::ProcessError::InvalidWorkerIdentity,
        )
        .into());
    }
    config
        .child_cgroup
        .ensure_empty()
        .map_err(crate::process::ProcessError::from)
        .map_err(series_analysis::ConsumerError::from)?;
    #[cfg(target_os = "linux")]
    config
        .child_cgroup
        .validate_resource_budget(config.execution_limits.memory)
        .map_err(crate::process::ProcessError::from)
        .map_err(series_analysis::ConsumerError::from)?;
    Ok(())
}
