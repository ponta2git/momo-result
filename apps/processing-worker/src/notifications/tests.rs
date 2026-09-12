#![expect(
    clippy::panic_in_result_fn,
    reason = "test assertions report the violated admission contract while setup errors propagate"
)]

use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn config() -> Result<NotificationConfig, NotificationConfigError> {
    NotificationConfig::http(
        "http://127.0.0.1:1/internal/discord-notifications",
        &"x".repeat(32),
    )
}

fn envelope() -> NotificationEnvelope<'static, serde_json::Value> {
    NotificationEnvelope::new(
        NotificationKind::OcrCompleted,
        "example-ocr-1",
        "2026-01-01T12:00:00.000Z".to_owned(),
        "0".to_owned(),
        serde_json::json!({"context": {"gameTitleName": null, "heldDateIso": null, "matchNoInEvent": null}}),
    )
}

#[test]
fn admission_bounds_cover_preparation_and_pending_requests()
-> Result<(), Box<dyn std::error::Error>> {
    let (sink, driver) = NotificationDriver::new(config()?)?;
    let first = sink
        .reserve(MAXIMUM_WIRE_BYTES)
        .map_err(|_error| "first reservation")?;
    let second = sink
        .reserve(MAXIMUM_WIRE_BYTES)
        .map_err(|_error| "second reservation")?;
    assert!(
        matches!(sink.reserve(1), Err(SkipReason::Capacity)),
        "reserved bytes must include preparing payloads"
    );
    drop(first);
    drop(second);
    for _ in 0..MAXIMUM_PENDING {
        sink.reserve(1024)
            .map_err(|_error| "count reservation")?
            .prepare(&envelope())
            .map_err(|_error| "prepare fixture")?
            .dispatch();
    }
    assert!(
        matches!(sink.reserve(1), Err(SkipReason::Capacity)),
        "pending sends must retain count permits"
    );
    drop(driver);
    assert!(
        matches!(sink.reserve(1), Err(SkipReason::SenderClosed)),
        "closed sender is not available"
    );
    Ok(())
}

#[test]
fn oversized_snapshot_is_discarded_and_releases_admission() -> Result<(), Box<dyn std::error::Error>>
{
    let (sink, _driver) = NotificationDriver::new(config()?)?;
    let reservation = sink.reserve(16).map_err(|_error| "fixture reservation")?;
    assert!(
        matches!(
            reservation.prepare(&envelope()),
            Err(SkipReason::PayloadBound)
        ),
        "bounded serialization cannot grow past its reservation"
    );
    assert!(
        sink.reserve(MAXIMUM_WIRE_BYTES).is_ok(),
        "failed preparation must release its bytes"
    );
    Ok(())
}

#[test]
fn configuration_rejects_public_or_credential_bearing_targets() {
    for url in [
        "https://example.com/internal/discord-notifications",
        "http://user@localhost/internal/discord-notifications",
        "http://localhost/internal/discord-notifications?token=x",
        "http://localhost/internal/discord-notifications#fragment",
        "http://localhost/internal/notifications",
    ] {
        assert!(
            NotificationConfig::http(url, &"x".repeat(32)).is_err(),
            "unsafe target should be rejected"
        );
    }
    assert!(
        NotificationConfig::http("http://localhost/internal/discord-notifications", "short")
            .is_err(),
        "short credentials are invalid configuration"
    );
}

#[tokio::test]
async fn http_sends_once_without_redirect_or_automatic_retry()
-> Result<(), Box<dyn std::error::Error>> {
    for status in [
        "202 Accepted",
        "200 OK",
        "302 Found",
        "503 Service Unavailable",
        "disconnect",
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!(
            "http://{}/internal/discord-notifications",
            listener.local_addr()?
        );
        let (sink, driver) =
            NotificationDriver::new(NotificationConfig::http(&endpoint, &"x".repeat(32))?)?;
        sink.reserve(1024)
            .map_err(|_error| "fixture reservation")?
            .prepare(&envelope())
            .map_err(|_error| "fixture serialization")?
            .dispatch();
        drop(sink);
        let server = async {
            let (mut socket, _) = listener.accept().await?;
            let request = read_request(&mut socket).await?;
            assert_eq!(request, serde_json::to_value(envelope())?);
            if status != "disconnect" {
                let body = if status == "202 Accepted" {
                    r#"{"notificationId":"result:ocr_completed:example-ocr-1","disposition":"accepted","status":"PENDING"}"#
                } else {
                    r#"{"notificationId":"result:ocr_completed:example-ocr-1","disposition":"duplicate","status":"DELIVERED"}"#
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: {endpoint}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await?;
            }
            drop(socket);
            Ok::<_, Box<dyn std::error::Error>>(listener)
        };
        let (server_result, ()) = tokio::join!(server, driver.run());
        let remaining_listener = server_result?.into_std()?;
        match remaining_listener.accept() {
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(error.into()),
            Ok(_) => return Err("notification was automatically retried or redirected".into()),
        }
    }
    Ok(())
}

#[tokio::test]
async fn active_http_keeps_its_permit_without_blocking_other_work()
-> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!(
        "http://{}/internal/discord-notifications",
        listener.local_addr()?
    );
    let (sink, driver) =
        NotificationDriver::new(NotificationConfig::http(&endpoint, &"x".repeat(32))?)?;
    sink.reserve(1024)
        .map_err(|_error| "fixture reservation")?
        .prepare(&envelope())
        .map_err(|_error| "fixture serialization")?
        .dispatch();
    let business_work = async {
        let (mut socket, _) = listener.accept().await?;
        read_request(&mut socket).await?;
        // The request remains unanswered while independent producers continue to use admission.
        let waiting = (1..MAXIMUM_PENDING)
            .map(|_| sink.reserve(1))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_error| "other work could not reserve available slots")?;
        assert!(
            matches!(sink.reserve(1), Err(SkipReason::Capacity)),
            "active HTTP must retain its count permit"
        );
        drop(waiting);
        drop(sink);
        socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
        Ok::<_, Box<dyn std::error::Error>>(())
    };
    let (result, ()) = tokio::join!(business_work, driver.run());
    result
}

async fn read_request(
    socket: &mut tokio::net::TcpStream,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let count = socket.read(&mut buffer).await?;
        if count == 0 || bytes.len() + count > 8192 {
            return Err("incomplete or oversized test request".into());
        }
        bytes.extend_from_slice(buffer.get(..count).ok_or("read bound")?);
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = std::str::from_utf8(bytes.get(..end).ok_or("header bound")?)?;
            assert!(
                headers.starts_with("POST /internal/discord-notifications HTTP/1.1\r\n"),
                "sender must use the shared internal endpoint"
            );
            let length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>())
                        .transpose()
                        .ok()
                        .flatten()
                })
                .ok_or("request content length")?;
            let body = bytes.get(end + 4..).ok_or("body bound")?;
            if body.len() == length {
                return Ok(serde_json::from_slice(body)?);
            }
        }
    }
}
