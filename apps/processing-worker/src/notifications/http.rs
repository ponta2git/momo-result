use reqwest::{Client, StatusCode, header};
use serde::Deserialize;

use super::{QueuedNotification, config::HttpConfig};

const MAXIMUM_RECEIPT_BYTES: usize = 4096;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    notification_id: String,
    disposition: String,
    status: String,
}

enum ReceiptOutcome {
    Stored(Receipt),
    Rejected,
    Unknown(&'static str),
}

pub(super) async fn send(client: &Client, config: &HttpConfig, mut entry: QueuedNotification) {
    let Some(body) = entry.body.take() else {
        return;
    };
    entry.attempted = true;
    tracing::info!(event = "result_notification_attempt", notification_id = %entry.id,
        source_job_id = %entry.source_job_id, kind = entry.kind);
    // No error_for_status/body/URL/debug output: even an HTTP 503 may follow a committed receipt.
    let outcome = match client
        .post(config.endpoint.clone())
        .header(header::AUTHORIZATION, config.authorization.clone())
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
    {
        Ok(response) => read_receipt(response, &entry.id).await,
        Err(error) => ReceiptOutcome::Unknown(match (error.is_connect(), error.is_timeout()) {
            (true, true) => "connect_timeout",
            (true, false) => "connect",
            (false, true) => "request_timeout",
            (false, false) => "transport",
        }),
    };
    match outcome {
        ReceiptOutcome::Stored(receipt) => tracing::info!(
            event = "result_notification_receipt", notification_id = %entry.id,
            source_job_id = %entry.source_job_id, kind = entry.kind,
            receipt = "stored", disposition = %receipt.disposition, status = %receipt.status,
        ),
        ReceiptOutcome::Rejected => tracing::warn!(
            event = "result_notification_receipt", notification_id = %entry.id,
            source_job_id = %entry.source_job_id, kind = entry.kind, receipt = "rejected",
        ),
        ReceiptOutcome::Unknown(reason) => tracing::warn!(
            event = "result_notification_receipt", notification_id = %entry.id,
            source_job_id = %entry.source_job_id, kind = entry.kind, receipt = "unknown", reason,
        ),
    }
    entry.finished = true;
}

async fn read_receipt(mut response: reqwest::Response, id: &str) -> ReceiptOutcome {
    let status = response.status();
    if matches!(status.as_u16(), 400 | 401 | 403 | 409 | 413 | 422) {
        return ReceiptOutcome::Rejected;
    }
    if !matches!(status, StatusCode::OK | StatusCode::ACCEPTED) {
        return ReceiptOutcome::Unknown("http_status");
    }
    let mut body = Vec::with_capacity(MAXIMUM_RECEIPT_BYTES);
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if chunk.len() <= MAXIMUM_RECEIPT_BYTES - body.len() => {
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Ok(Some(_)) => return ReceiptOutcome::Unknown("receipt_bound"),
            Err(_error) => return ReceiptOutcome::Unknown("receipt_transport"),
        }
    }
    parse_receipt(status, &body, id)
}

fn parse_receipt(status: StatusCode, body: &[u8], id: &str) -> ReceiptOutcome {
    let Ok(receipt) = serde_json::from_slice::<Receipt>(body) else {
        return ReceiptOutcome::Unknown("invalid_receipt");
    };
    let valid_status = matches!(
        receipt.status.as_str(),
        "PENDING" | "IN_FLIGHT" | "DELIVERED" | "FAILED" | "CANCELLED"
    );
    let consistent = match (status, receipt.disposition.as_str()) {
        (StatusCode::ACCEPTED, "accepted") => receipt.status == "PENDING",
        (StatusCode::OK, "duplicate") => valid_status,
        (StatusCode::OK, "cancelled") => receipt.status == "CANCELLED",
        _ => false,
    };
    if receipt.notification_id == id && consistent {
        ReceiptOutcome::Stored(receipt)
    } else {
        ReceiptOutcome::Unknown("invalid_receipt")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_consistent_receipts_prove_persistence() {
        for (status, disposition, state, expected) in [
            (StatusCode::ACCEPTED, "accepted", "PENDING", true),
            (StatusCode::OK, "duplicate", "DELIVERED", true),
            (StatusCode::OK, "cancelled", "CANCELLED", true),
            (StatusCode::OK, "accepted", "PENDING", false),
            (StatusCode::ACCEPTED, "accepted", "DELIVERED", false),
            (StatusCode::OK, "cancelled", "PENDING", false),
            (StatusCode::OK, "duplicate", "unknown", false),
        ] {
            let body = format!(
                r#"{{"notificationId":"test-id","disposition":"{disposition}","status":"{state}"}}"#
            );
            assert_eq!(
                matches!(
                    parse_receipt(status, body.as_bytes(), "test-id"),
                    ReceiptOutcome::Stored(_)
                ),
                expected
            );
            assert!(
                matches!(
                    parse_receipt(status, body.as_bytes(), "other-id"),
                    ReceiptOutcome::Unknown(_)
                ),
                "receipt identity must match"
            );
        }
        assert!(
            matches!(
                parse_receipt(StatusCode::ACCEPTED, b"{}", "test-id"),
                ReceiptOutcome::Unknown(_)
            ),
            "an invalid 2xx body is unknown"
        );
    }
}
