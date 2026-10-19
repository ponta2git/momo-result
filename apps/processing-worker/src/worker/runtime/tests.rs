#![expect(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "test-owned channels and bounded joins make lifecycle ordering failures explicit"
)]

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tokio::sync::oneshot;

use super::*;

struct Dropped(Arc<AtomicBool>);

impl Drop for Dropped {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn runtime() -> (watch::Sender<bool>, Runtime) {
    let (external, receiver) = watch::channel(false);
    (
        external,
        Runtime::new(receiver, Duration::from_secs(1), Duration::from_millis(100)),
    )
}

#[tokio::test]
async fn stop_signals_siblings_without_dropping_the_in_flight_operation() {
    let (external, mut runtime) = runtime();
    let mut stopped = runtime.stopped.clone();
    let (started, start) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let dropped = Arc::new(AtomicBool::new(false));
    let operation_dropped = Arc::clone(&dropped);

    let operation = runtime.operation(async move {
        let _guard = Dropped(operation_dropped);
        started.send(()).unwrap();
        released.await.unwrap();
        Ok(41)
    });
    let controller = async {
        start.await.unwrap();
        external.send_replace(true);
        stopped.wait_for(|value| *value).await.unwrap();
        assert!(!dropped.load(Ordering::SeqCst));
        release.send(()).unwrap();
    };
    let (result, ()) = time::timeout(Duration::from_secs(2), async {
        tokio::join!(operation, controller)
    })
    .await
    .expect("stop must be observed while the operation is waiting");

    assert_eq!(result.unwrap(), 41);
    assert!(dropped.load(Ordering::SeqCst));
    assert!(runtime.stopping());
    assert!(finish(&mut runtime, &mut None).await.is_ok());
}

#[tokio::test]
async fn listener_error_is_observed_while_a_durable_operation_waits() {
    let (_external, mut runtime) = runtime();
    let mut stopped = runtime.stopped.clone();
    let (fail, failure) = oneshot::channel();
    runtime.listener = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            failure.await.unwrap();
            Err(WorkerError::UnexpectedExit)
        },
    ));
    let (started, start) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let dropped = Arc::new(AtomicBool::new(false));
    let operation_dropped = Arc::clone(&dropped);

    let operation = runtime.operation(async move {
        let _guard = Dropped(operation_dropped);
        started.send(()).unwrap();
        released.await.unwrap();
        Ok(())
    });
    let controller = async {
        start.await.unwrap();
        fail.send(()).unwrap();
        stopped.wait_for(|value| *value).await.unwrap();
        assert!(!dropped.load(Ordering::SeqCst));
        release.send(()).unwrap();
    };
    let (result, ()) = time::timeout(Duration::from_secs(2), async {
        tokio::join!(operation, controller)
    })
    .await
    .expect("listener failure must stop siblings during a dependency wait");

    result.unwrap();
    assert!(runtime.listener.is_none());
    assert!(matches!(
        finish(&mut runtime, &mut None).await,
        Err(WorkerError::UnexpectedExit)
    ));
}

#[tokio::test]
#[expect(
    clippy::panic,
    reason = "the attempt unwind is the lifecycle event under test"
)]
async fn attempt_panic_stops_siblings_and_keeps_the_original_failure() {
    let (_external, mut runtime) = runtime();
    let mut stopped = runtime.stopped.clone();
    let (panic_now, panic_requested) = oneshot::channel();
    runtime.active = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            panic_requested.await.unwrap();
            panic!("controlled attempt panic");
        },
    ));
    let (started, start) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let dropped = Arc::new(AtomicBool::new(false));
    let operation_dropped = Arc::clone(&dropped);

    let operation = runtime.operation(async move {
        let _guard = Dropped(operation_dropped);
        started.send(()).unwrap();
        released.await.unwrap();
        Ok(())
    });
    let controller = async {
        start.await.unwrap();
        panic_now.send(()).unwrap();
        stopped.wait_for(|value| *value).await.unwrap();
        assert!(!dropped.load(Ordering::SeqCst));
        release.send(()).unwrap();
    };
    let (result, ()) = time::timeout(Duration::from_secs(2), async {
        tokio::join!(operation, controller)
    })
    .await
    .expect("attempt panic must stop siblings during a dependency wait");

    result.unwrap();
    let deadline = runtime
        .deadline
        .expect("panic must start the common deadline");
    let shutdown_result = finish(&mut runtime, &mut None).await;
    assert!(matches!(
        shutdown_result,
        Err(WorkerError::Execution(
            crate::execution::ExecutionError::Panic
        ))
    ));
    assert!(runtime.active.is_none());
    assert_eq!(runtime.deadline, Some(deadline));
}

#[tokio::test]
#[expect(
    clippy::panic,
    reason = "the operation unwind is the lifecycle event under test"
)]
async fn operation_panic_is_finalized_through_the_common_stop_path() {
    let (_external, mut runtime) = runtime();
    let mut stopped = runtime.stopped.clone();
    runtime.listener = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            stopped.wait_for(|value| *value).await.unwrap();
            Ok(())
        },
    ));

    let result: Result<(), WorkerError> = runtime
        .operation(async {
            panic!("controlled operation panic");
        })
        .await;
    runtime.fail(result.unwrap_err());
    let deadline = runtime.deadline;
    runtime.request_stop();
    runtime.fail(WorkerError::CleanupFailed);

    assert_eq!(runtime.deadline, deadline);
    assert!(*runtime.stopped.borrow());
    assert!(matches!(
        finish(&mut runtime, &mut None).await,
        Err(WorkerError::Panicked)
    ));
    assert!(runtime.listener.is_none());
    assert_eq!(runtime.deadline, deadline);
}

#[tokio::test]
async fn a_waiting_operation_is_dropped_when_the_common_graceful_deadline_expires() {
    let (_external, mut runtime) = runtime();
    runtime.timeout = Duration::from_millis(100);
    runtime.cleanup_grace = Duration::from_millis(50);
    runtime.request_stop();
    let deadline = runtime.deadline;
    let dropped = Arc::new(AtomicBool::new(false));
    let operation_dropped = Arc::clone(&dropped);

    let result: Result<(), WorkerError> = runtime
        .operation(async move {
            let _guard = Dropped(operation_dropped);
            std::future::pending().await
        })
        .await;

    assert!(matches!(result, Err(WorkerError::ShutdownDrainTimeout)));
    assert!(dropped.load(Ordering::SeqCst));
    assert_eq!(runtime.deadline, deadline);
}

#[tokio::test]
async fn forced_listener_stop_is_joined_within_the_original_shutdown_budget() {
    let (_external, mut runtime) = runtime();
    runtime.timeout = Duration::from_millis(100);
    runtime.cleanup_grace = Duration::from_millis(50);
    let (started, start) = oneshot::channel();
    let dropped = Arc::new(AtomicBool::new(false));
    let listener_dropped = Arc::clone(&dropped);
    runtime.listener = Some(ExecutionHandle::spawn(
        runtime.stop.clone(),
        runtime.cleanup_grace,
        async move {
            let _guard = Dropped(listener_dropped);
            started.send(()).unwrap();
            std::future::pending().await
        },
    ));
    time::timeout(Duration::from_secs(1), start)
        .await
        .expect("listener starts before shutdown")
        .unwrap();

    runtime.request_stop();
    let deadline = runtime.deadline.expect("shutdown has a hard deadline");
    let graceful_until = runtime.graceful_deadline().unwrap();
    runtime.fail(WorkerError::UnexpectedExit);
    assert!(!dropped.load(Ordering::SeqCst));

    let shutdown_result = time::timeout_at(deadline, finish(&mut runtime, &mut None))
        .await
        .expect("forced completion must fit within the original hard deadline");

    assert!(matches!(shutdown_result, Err(WorkerError::UnexpectedExit)));
    assert!(
        dropped.load(Ordering::SeqCst),
        "finish must observe task destruction, not merely request an abort"
    );
    assert!(runtime.listener.is_none());
    assert!(time::Instant::now() >= graceful_until);
    assert_eq!(runtime.deadline, Some(deadline));
}
