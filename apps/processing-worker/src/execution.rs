//! Owns one asynchronous execution and the process resources it must return before completion.
//!
//! The task-local scope is used only by the process adapter. Domain code still returns its concrete
//! result and reusable resources; it does not register jobs or implement a lifecycle trait.

use std::{
    future::Future,
    panic::AssertUnwindSafe,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use futures_util::FutureExt;
use thiserror::Error;
use tokio::{
    sync::{Mutex as AsyncMutex, watch},
    task::{AbortHandle, JoinError, JoinHandle},
    time::{self, Instant},
};

use crate::process::{EmergencyChild, ProcessError, RecoveredChild};

tokio::task_local! {
    static PROCESS_RESOURCES: Arc<Resources>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CleanupState {
    Clean,
    Pending,
    Failed { kind: &'static str },
}

#[derive(Debug, Error)]
pub(crate) enum ExecutionError {
    #[error("execution task panicked")]
    Panic,
    #[error("execution task did not return its result")]
    Task(#[source] JoinError),
    #[error("execution completion was already consumed")]
    AlreadyCompleted,
    #[error("execution cleanup exceeded its deadline")]
    CleanupDeadline,
    #[error("execution cleanup failed ({kind})")]
    Cleanup { kind: &'static str },
}

/// A cancellation-safe completion handle with the same stop and cleanup contract for every task.
///
/// `T` remains the caller's concrete result, including any runner resources and domain error. A
/// cleanup failure requests common shutdown and is retained separately, so it cannot replace that
/// domain error. Callers must inspect `cleanup_state` before admitting another attempt.
pub(crate) struct ExecutionHandle<T> {
    task: Option<JoinHandle<Result<T, ExecutionError>>>,
    result: Option<Result<T, ExecutionError>>,
    resources: Arc<Resources>,
    shutdown: watch::Sender<bool>,
    cleanup_grace: Duration,
    cleanup_deadline: Option<Instant>,
    cleanup_finished: bool,
}

impl<T: Send + 'static> ExecutionHandle<T> {
    pub(crate) fn spawn(
        shutdown: watch::Sender<bool>,
        cleanup_grace: Duration,
        future: impl Future<Output = T> + Send + 'static,
    ) -> Self {
        let resources = Arc::new(Resources::default());
        let task_resources = Arc::clone(&resources);
        let task_shutdown = shutdown.clone();
        let task = tokio::spawn(PROCESS_RESOURCES.scope(task_resources, async move {
            // Only the owned business future is asserted unwind-safe. It is discarded after a
            // panic and is never resumed; process recovery resources live outside its unwind.
            match AssertUnwindSafe(future).catch_unwind().await {
                Ok(value) => Ok(value),
                Err(payload) => {
                    task_shutdown.send_replace(true);
                    drop(payload);
                    Err(ExecutionError::Panic)
                }
            }
        }));
        Self {
            task: Some(task),
            result: None,
            resources,
            shutdown,
            cleanup_grace,
            cleanup_deadline: None,
            cleanup_finished: false,
        }
    }

    pub(crate) fn request_stop(&self) {
        self.shutdown.send_replace(true);
    }

    pub(crate) fn cleanup_state(&self) -> CleanupState {
        self.resources.cleanup_state()
    }

    /// Signals only resources belonging to this execution. A verified child registration is
    /// retired before its slot may be reused, so an old handle cannot kill a later attempt.
    pub(crate) fn emergency_stop(&self) -> Result<(), ProcessError> {
        self.resources.emergency_stop()
    }

    /// May be polled in `select!`: the task, result, child, and cleanup deadline remain owned here
    /// if another branch wins. A subsequent call resumes cleanup without extending its deadline.
    pub(crate) async fn completed(&mut self) -> Result<T, ExecutionError> {
        self.observe_completion().await?;
        if !self.cleanup_finished {
            let deadline = if let Some(deadline) = self.cleanup_deadline {
                deadline
            } else if let Some(deadline) = Instant::now().checked_add(self.cleanup_grace) {
                self.cleanup_deadline = Some(deadline);
                deadline
            } else {
                self.fail_cleanup("child_stop_timeout_bound");
                self.cleanup_finished = true;
                return self.result.take().ok_or(ExecutionError::AlreadyCompleted)?;
            };
            if self.resources.cleanup_state() != CleanupState::Clean {
                // A child that was dropped without verified cleanup must not leave another
                // worker task running while this handle recovers it.
                self.request_stop();
            }
            if let Err(error) = self.cleanup_until(deadline).await {
                tracing::error!(event = "execution_cleanup_failed", error = %error);
            }
            self.cleanup_finished = true;
        }
        self.result.take().ok_or(ExecutionError::AlreadyCompleted)?
    }

    /// Used only after the graceful phase has expired. The supplied deadline is the worker's
    /// existing absolute deadline, not a new duration. Cancellation leaves all recovery state here.
    pub(crate) async fn abort_and_cleanup(
        &mut self,
        deadline: Instant,
    ) -> Result<(), ExecutionError> {
        self.request_stop();
        if let Err(error) = self.emergency_stop() {
            self.fail_cleanup(error.kind());
        }
        if let Some(task) = &self.task {
            task.abort();
        }
        if time::timeout_at(deadline, self.observe_completion())
            .await
            .is_err()
        {
            self.fail_cleanup("execution_abort_timeout");
            return Err(ExecutionError::CleanupDeadline);
        }
        let deadline = self
            .cleanup_deadline
            .map_or(deadline, |previous| previous.min(deadline));
        self.cleanup_deadline = Some(deadline);
        self.cleanup_until(deadline).await
    }

    async fn observe_completion(&mut self) -> Result<(), ExecutionError> {
        if self.result.is_some() {
            return Ok(());
        }
        let Some(task) = self.task.as_mut() else {
            return Err(ExecutionError::AlreadyCompleted);
        };
        let result = match task.await {
            Ok(result) => result,
            Err(error) => Err(ExecutionError::Task(error)),
        };
        if result.is_err() {
            self.request_stop();
        }
        self.result = Some(result);
        drop(self.task.take());
        Ok(())
    }

    #[expect(
        clippy::needless_pass_by_ref_mut,
        reason = "an exclusive borrow keeps this future Send without requiring the owned result T to be Sync"
    )]
    async fn cleanup_until(&mut self, deadline: Instant) -> Result<(), ExecutionError> {
        match time::timeout_at(deadline, self.resources.cleanup_until(deadline)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                let kind = error.kind();
                self.fail_cleanup(kind);
                Err(ExecutionError::Cleanup { kind })
            }
            Err(_elapsed) => {
                self.fail_cleanup("execution_cleanup_timeout");
                Err(ExecutionError::CleanupDeadline)
            }
        }
    }

    fn fail_cleanup(&self, kind: &'static str) {
        self.resources.metadata().failure.get_or_insert(kind);
        self.request_stop();
        drop(self.emergency_stop());
    }
}

impl<T> Drop for ExecutionHandle<T> {
    fn drop(&mut self) {
        if self.task.is_some() || self.resources.cleanup_state() != CleanupState::Clean {
            drop(self.resources.emergency_stop());
            if let Some(task) = &self.task {
                task.abort();
            }
        }
    }
}

#[derive(Default)]
struct Resources {
    metadata: Mutex<Metadata>,
    returned: Mutex<Option<RecoveredChild>>,
    // Taking a child out of `returned` must never make it local to a cancellable cleanup future.
    // This owner is shared with T0; only its asynchronous lock guard crosses an await.
    recovering: AsyncMutex<Option<RecoveredChild>>,
}

#[derive(Default)]
struct Metadata {
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child registration occurs in the Linux adapter"
        )
    )]
    registered: bool,
    child: Option<EmergencyChild>,
    auxiliary: Vec<AuxiliaryTask>,
    failure: Option<&'static str>,
}

struct AuxiliaryTask {
    abort: AbortHandle,
    finished: watch::Receiver<bool>,
}

impl Resources {
    fn metadata(&self) -> MutexGuard<'_, Metadata> {
        // These short critical sections never call domain code or await. Even if a surrounding
        // panic poisoned the lock, recovery must still retain the handles it already contains.
        self.metadata
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn cleanup_state(&self) -> CleanupState {
        let state = self.metadata();
        state.failure.map_or_else(
            || {
                if state.child.is_some()
                    || state.auxiliary.iter().any(|task| !task.abort.is_finished())
                {
                    CleanupState::Pending
                } else {
                    CleanupState::Clean
                }
            },
            |kind| CleanupState::Failed { kind },
        )
    }

    fn emergency_stop(&self) -> Result<(), ProcessError> {
        let state = self.metadata();
        for task in &state.auxiliary {
            task.abort.abort();
        }
        state.child.as_ref().map_or(Ok(()), EmergencyChild::stop)
    }

    async fn cleanup_until(&self, deadline: Instant) -> Result<(), ProcessError> {
        let auxiliaries = {
            let state = self.metadata();
            state
                .auxiliary
                .iter()
                .map(|task| {
                    task.abort.abort();
                    (task.abort.clone(), task.finished.clone())
                })
                .collect::<Vec<_>>()
        };
        let mut recovering = self.recovering.lock().await;
        if recovering.is_none() {
            *recovering = self
                .returned
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
        }
        let child_result = if let Some(child) = recovering.as_mut() {
            let result = child.cleanup(deadline).await;
            if result.is_ok() {
                self.metadata().child = None;
                drop(recovering.take());
            }
            result
        } else if self.metadata().child.is_some() {
            Err(ProcessError::ChildCleanupOwnership)
        } else {
            Ok(())
        };
        drop(recovering);
        // Completion signals survive the original typed JoinHandle being unwound. is_finished
        // additionally confirms Tokio finished cancelling the task, including its destructors.
        for (abort, mut finished) in auxiliaries {
            while !abort.is_finished() {
                if *finished.borrow() || finished.has_changed().is_err() {
                    tokio::task::yield_now().await;
                } else {
                    drop(finished.changed().await);
                }
            }
        }
        child_result
    }
}

impl Drop for Resources {
    fn drop(&mut self) {
        drop(self.emergency_stop());
    }
}

pub(crate) struct ChildRegistration {
    resources: Arc<Resources>,
}

impl ChildRegistration {
    pub(crate) fn verified(&self) {
        self.resources.metadata().child = None;
    }

    pub(crate) fn recover(self, child: RecoveredChild) {
        let mut returned = self
            .resources
            .returned
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if returned.is_none() {
            *returned = Some(child);
            drop(returned);
        } else {
            drop(returned);
            self.resources.metadata().failure = Some("child_cleanup_ownership");
            // This cannot happen with the one-child registration contract. Preserve the first
            // recovery owner and synchronously stop the conflicting resource before dropping it.
            drop(child);
        }
    }
}

#[cfg_attr(
    all(not(target_os = "linux"), not(test)),
    expect(
        dead_code,
        reason = "production child registration occurs in the Linux adapter"
    )
)]
pub(crate) fn register_child(
    child: EmergencyChild,
) -> Result<Option<ChildRegistration>, ProcessError> {
    let Ok(resources) = PROCESS_RESOURCES.try_with(Arc::clone) else {
        return Ok(None);
    };
    {
        let mut state = resources.metadata();
        if state.registered {
            return Err(ProcessError::ChildCleanupOwnership);
        }
        state.registered = true;
        state.child = Some(child);
    }
    Ok(Some(ChildRegistration { resources }))
}

/// The typed IO result stays with the process adapter. Its independent cancellation/completion
/// capability is retained by the execution scope before the newly spawned task can be polled.
#[cfg_attr(
    all(not(target_os = "linux"), not(test)),
    expect(
        dead_code,
        reason = "OCR child pipes are created by the Linux process adapter"
    )
)]
pub(crate) fn spawn_child_io<T: Send + 'static>(
    future: impl Future<Output = T> + Send + 'static,
) -> JoinHandle<T> {
    let Ok(resources) = PROCESS_RESOURCES.try_with(Arc::clone) else {
        return tokio::spawn(future);
    };
    let (finished, receiver) = watch::channel(false);
    let signal = FinishedSignal(finished);
    let task = tokio::spawn(async move {
        let result = future.await;
        drop(signal);
        result
    });
    resources.metadata().auxiliary.push(AuxiliaryTask {
        abort: task.abort_handle(),
        finished: receiver,
    });
    task
}

struct FinishedSignal(watch::Sender<bool>);

impl Drop for FinishedSignal {
    fn drop(&mut self) {
        self.0.send_replace(true);
    }
}
