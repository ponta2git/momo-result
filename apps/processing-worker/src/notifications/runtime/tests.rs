#![expect(
    clippy::panic_in_result_fn,
    reason = "assertions preserve the tested task/transport boundary while fixture setup errors propagate"
)]

use std::{error::Error, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use super::*;
use crate::notifications::{
    NotificationEnvelope, NotificationKind, NotificationRejection, PreparedNotification,
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

async fn transport() -> TestResult<(TcpListener, NotificationSink, NotificationDriver)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!(
        "http://{}/internal/discord-notifications",
        listener.local_addr()?
    );
    let (sink, driver) =
        NotificationDriver::new(NotificationConfig::http(&endpoint, &"x".repeat(32))?)?;
    Ok((listener, sink, driver))
}

fn prepared(sink: &NotificationSink) -> TestResult<PreparedNotification> {
    let envelope = NotificationEnvelope::new(
        NotificationKind::OcrCompleted,
        "sender-lifecycle-fixture",
        "2026-01-01T00:00:00.000Z".to_owned(),
        "0".to_owned(),
        serde_json::json!({"context": {"gameTitleName": "fixture"}}),
    );
    Ok(sink
        .reserve(1024)
        .map_err(|_error| "reserve notification fixture")?
        .prepare_for_test(&envelope)
        .map_err(|_error| "encode notification fixture")?)
}

#[tokio::test]
#[expect(
    clippy::panic,
    reason = "a transport task unwind must close admission without unwinding the business task"
)]
#[expect(
    clippy::significant_drop_tightening,
    reason = "the notification must be reserved before sender failure and dispatched afterward"
)]
async fn sender_panic_closes_admission_without_failing_business() -> TestResult {
    let (_listener, sink, driver) = transport().await?;
    let reserved = prepared(&sink)?;
    let mut handle = NotificationHandle::spawn(async move {
        let _driver = driver;
        panic!("injected sender task panic");
    });
    time::timeout(Duration::from_secs(2), handle.completed()).await?;
    assert!(handle.is_finished());
    assert!(matches!(
        sink.reserve(1),
        Err(NotificationRejection::SenderClosed)
    ));
    // An already prepared last commit also tolerates the failed receiver.
    reserved.dispatch();
    assert_eq!(tokio::spawn(async { 42 }).await?, 42);
    Ok(())
}

#[tokio::test]
#[expect(
    clippy::significant_drop_tightening,
    reason = "the reservation intentionally spans cancellation of the sender completion observer"
)]
async fn last_dispatch_survives_cancelled_observation_and_drains() -> TestResult {
    let (listener, sink, driver) = transport().await?;
    let reserved = prepared(&sink)?;
    let mut handle = driver.spawn();
    assert!(
        time::timeout(Duration::from_millis(10), handle.completed())
            .await
            .is_err()
    );
    assert!(!handle.is_finished());
    reserved.dispatch();
    drop(sink);
    let server = async {
        let (mut socket, _) = listener.accept().await?;
        let request = read_request(&mut socket).await?;
        assert_eq!(
            request
                .get("notificationId")
                .and_then(serde_json::Value::as_str),
            Some("result:ocr_completed:sender-lifecycle-fixture")
        );
        let body = r#"{"notificationId":"result:ocr_completed:sender-lifecycle-fixture","disposition":"accepted","status":"PENDING"}"#;
        socket
            .write_all(
                format!(
                    "HTTP/1.1 202 Accepted\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .await?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    let graceful_until = deadline - Duration::from_secs(1);
    let (response, ()) = tokio::join!(
        time::timeout_at(deadline, server),
        handle.drain_until(graceful_until, deadline)
    );
    response??;
    assert!(handle.task.is_none(), "the normal sender result was joined");
    Ok(())
}

#[tokio::test]
async fn unanswered_http_is_aborted_without_a_business_error() -> TestResult {
    let (listener, sink, driver) = transport().await?;
    prepared(&sink)?.dispatch();
    drop(sink);
    let mut handle = driver.spawn();
    let (mut socket, _) = time::timeout(Duration::from_secs(2), listener.accept()).await??;
    time::timeout(Duration::from_secs(2), read_request(&mut socket)).await??;

    let graceful_until = Instant::now() + Duration::from_millis(10);
    let deadline = graceful_until + Duration::from_secs(2);
    handle.drain_until(graceful_until, deadline).await;
    assert!(
        handle.abort_requested,
        "the unresponsive request was aborted"
    );
    assert!(
        handle.task.is_none(),
        "drain must observe forced completion within the original shutdown budget"
    );
    let mut byte = [0_u8; 1];
    assert_eq!(
        time::timeout_at(deadline, socket.read(&mut byte)).await??,
        0
    );
    Ok(())
}

#[tokio::test]
async fn dropping_owner_aborts_the_sender_instead_of_detaching_it() -> TestResult {
    let (_listener, sink, driver) = transport().await?;
    let handle = driver.spawn();
    drop(handle);
    time::timeout(Duration::from_secs(2), async {
        while !matches!(sink.reserve(1), Err(NotificationRejection::SenderClosed)) {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    Ok(())
}

#[tokio::test]
async fn disabled_sender_is_a_normal_one_time_completion() -> TestResult {
    let mut handle = NotificationDriver::disabled().spawn();
    time::timeout(Duration::from_secs(2), handle.completed()).await?;
    assert!(handle.is_finished());
    assert!(
        time::timeout(Duration::from_millis(10), handle.completed())
            .await
            .is_err(),
        "a consumed completion must not spin the worker select loop"
    );
    let deadline = Instant::now();
    handle.drain_until(deadline, deadline).await;
    Ok(())
}

async fn read_request(socket: &mut TcpStream) -> TestResult<serde_json::Value> {
    let mut headers = Vec::new();
    while !headers.ends_with(b"\r\n\r\n") {
        if headers.len() >= 8192 {
            return Err("notification fixture headers exceeded their bound".into());
        }
        headers.push(socket.read_u8().await?);
    }
    let headers = std::str::from_utf8(&headers)?;
    let length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .ok_or("notification fixture content length")?;
    if length > 8192 {
        return Err("notification fixture body exceeded its bound".into());
    }
    let mut bytes = vec![0_u8; length];
    socket.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}
