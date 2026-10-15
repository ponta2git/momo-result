//! Bounds heavy parent-side file/JSON work independently of its caller's lifetime.
//!
//! The worker admits one heavy attempt at a time. Its blocking work keeps the same single
//! permit after an async timeout, rather than overlapping a subsequent attempt. Tokio's
//! general blocking pool remains available to filesystem and process adapters.

use std::sync::atomic::{AtomicBool, Ordering};

use tokio::{
    sync::{Mutex, MutexGuard},
    task::JoinError,
};

static HEAVY_WORK: BlockingWork = BlockingWork::new();

/// The enclosing operation owns the deadline, including time spent waiting for admission.
pub(crate) async fn run<T, F>(operation: F) -> Result<T, JoinError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    HEAVY_WORK.run(operation).await
}

/// Only work submitted to the blocking pool counts; cancelled admission waits do not.
pub(crate) fn has_pending_work() -> bool {
    HEAVY_WORK.pending.load(Ordering::Acquire)
}

struct BlockingWork {
    permit: Mutex<()>,
    pending: AtomicBool,
}

impl BlockingWork {
    const fn new() -> Self {
        Self {
            permit: Mutex::const_new(()),
            pending: AtomicBool::new(false),
        }
    }

    async fn run<T, F>(&'static self, operation: F) -> Result<T, JoinError>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let owned = PendingWork {
            _permit: self.permit.lock().await,
            pending: &self.pending,
        };
        self.pending.store(true, Ordering::Release);
        tokio::task::spawn_blocking(move || {
            // The closure, not the awaiting future, owns admission until execution ends.
            let _owned = owned;
            operation()
        })
        .await
    }
}

struct PendingWork {
    _permit: MutexGuard<'static, ()>,
    pending: &'static AtomicBool,
}

impl Drop for PendingWork {
    fn drop(&mut self) {
        self.pending.store(false, Ordering::Release);
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "test-owned channels expose admission and completion without filesystem timing assumptions"
)]
mod tests {
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };

    use tokio::{sync::oneshot, time};

    use super::*;

    #[tokio::test]
    async fn timed_out_caller_keeps_admission_until_blocking_work_finishes() {
        static WORK: BlockingWork = BlockingWork::new();
        let (started, start) = oneshot::channel();
        let (release, released) = mpsc::channel();
        let mut operation = Box::pin(WORK.run(move || {
            started.send(()).expect("signal blocking work start");
            released.recv().expect("release blocking work");
        }));
        tokio::select! {
            result = start => result.expect("blocking work started"),
            result = &mut operation => assert!(result.is_err(), "work cannot finish before release"),
        }
        assert!(WORK.pending.load(Ordering::Acquire));
        // Drop the actual calling future, not only a JoinHandle supervising that future.
        assert!(
            time::timeout(Duration::from_millis(10), operation)
                .await
                .is_err()
        );
        assert!(WORK.pending.load(Ordering::Acquire));
        let cancelled_started = Arc::new(AtomicBool::new(false));
        let cancelled_probe = Arc::clone(&cancelled_started);
        assert!(
            time::timeout(
                Duration::from_millis(10),
                WORK.run(move || cancelled_probe.store(true, Ordering::Release))
            )
            .await
            .is_err()
        );
        assert!(WORK.pending.load(Ordering::Acquire));

        release.send(()).expect("finish original blocking work");
        let result = time::timeout(Duration::from_secs(2), WORK.run(|| 42))
            .await
            .expect("admission resumes after actual completion")
            .expect("second blocking task completes");
        assert_eq!(result, 42);
        assert!(!WORK.pending.load(Ordering::Acquire));
        assert!(!cancelled_started.load(Ordering::Acquire));
    }
}
