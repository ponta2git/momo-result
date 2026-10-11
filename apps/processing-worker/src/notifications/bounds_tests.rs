#![expect(
    clippy::panic_in_result_fn,
    reason = "assertions identify admission violations while database setup errors propagate"
)]

use super::*;
use tokio_postgres::{Transaction, types::Type};

fn sized_envelope(
    kind: NotificationKind,
    data: serde_json::Value,
) -> NotificationEnvelope<'static, serde_json::Value> {
    NotificationEnvelope::new(
        kind,
        "notification-size-boundary",
        "2026-01-01T00:00:00.000Z".to_owned(),
        "0".to_owned(),
        data,
    )
}

async fn jsonb_bytes(
    transaction: &Transaction<'_>,
    envelope: &NotificationEnvelope<'_, serde_json::Value>,
) -> Result<usize, Box<dyn std::error::Error>> {
    let wire = serde_json::to_string(envelope)?;
    let row = transaction
        .query_typed_one(
            "SELECT octet_length($1::jsonb::text)",
            &[(&wire, Type::TEXT)],
        )
        .await?;
    Ok(usize::try_from(row.try_get::<_, i32>(0)?)?)
}

// Exercise count and byte recovery through the public API; the crate's unit tests own the
// absolute limits. Analysis-sized reservations consume both budgets, unlike small OCR fixtures.
fn available_capacity(sink: &NotificationSink) -> Result<usize, Box<dyn std::error::Error>> {
    let mut reservations = Vec::new();
    for _ in 0..64 {
        match sink.reserve(NotificationKind::AnalysisCompleted.maximum_jsonb_bytes()) {
            Ok(reservation) => reservations.push(reservation),
            Err(NotificationRejection::Capacity) => return Ok(reservations.len()),
            Err(_) => return Err("unexpected admission rejection".into()),
        }
    }
    Err("notification admission did not reach capacity".into())
}

#[tokio::test]
#[ignore = "requires explicitly isolated PostgreSQL"]
async fn real_postgres_preparation_enforces_complete_jsonb_limits()
-> Result<(), Box<dyn std::error::Error>> {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("an explicitly isolated database is required".into());
    }
    let mut client = crate::postgres::connect(&database_url).await?;
    let transaction = client.transaction().await?;
    let (sink, _driver) = NotificationDriver::new(NotificationConfig::http(
        "http://127.0.0.1:1/internal/discord-notifications",
        &"x".repeat(32),
    )?)?;

    let capacity_before = available_capacity(&sink)?;
    assert!(
        capacity_before > 0,
        "the sender must admit prepared snapshots"
    );

    for (kind, limit) in [
        (NotificationKind::OcrCompleted, 16 * 1024_usize),
        (NotificationKind::AnalysisCompleted, 256 * 1024_usize),
    ] {
        let empty = sized_envelope(kind, serde_json::json!({"padding": ""}));
        let overhead = jsonb_bytes(&transaction, &empty).await?;
        for excess in [0, 1] {
            let padding = "x".repeat(limit - overhead + excess);
            let envelope = sized_envelope(kind, serde_json::json!({"padding": padding}));
            assert_eq!(jsonb_bytes(&transaction, &envelope).await?, limit + excess);
            assert!(
                serde_json::to_vec(&envelope)?.len() < limit,
                "compact wire alone cannot enforce the JSONB limit"
            );
            let prepared = sink
                .reserve(limit)
                .map_err(|_error| "reserve boundary")?
                .prepare_in(&transaction, &envelope)
                .await?;
            if excess == 0 {
                let prepared = prepared.map_err(|_error| "exact JSONB boundary was rejected")?;
                assert_eq!(prepared.payload()?, serde_json::to_value(&envelope)?);
            } else {
                assert!(
                    matches!(prepared, Err(NotificationRejection::PayloadBound)),
                    "the full envelope must fit its kind's limit"
                );
                drop(prepared);
            }
        }
    }

    // Small wire tokens may expand to much larger JSONB numbers and add separator spaces.
    let numeric = sized_envelope(
        NotificationKind::OcrCompleted,
        serde_json::json!({"values": vec![1.0e-20_f64; 1000]}),
    );
    assert!(
        serde_json::to_vec(&numeric)?.len() < 16 * 1024,
        "numeric fixture must fit the wire limit"
    );
    assert!(
        jsonb_bytes(&transaction, &numeric).await? > 16 * 1024,
        "numeric fixture must exceed the receiver's JSONB limit"
    );
    assert!(
        matches!(
            sink.reserve(16 * 1024)
                .map_err(|_error| "reserve numeric")?
                .prepare_in(&transaction, &numeric)
                .await?,
            Err(NotificationRejection::PayloadBound)
        ),
        "JSONB numeric expansion must be checked before handoff"
    );
    assert_eq!(
        available_capacity(&sink)?,
        capacity_before,
        "preparation rejection and dropped snapshots must release both admission budgets"
    );
    transaction.rollback().await?;
    Ok(())
}
