#![expect(
    clippy::panic_in_result_fn,
    reason = "assertions identify admission violations while database setup errors propagate"
)]

use super::*;

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
                    matches!(prepared, Err(SkipReason::PayloadBound)),
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
            Err(SkipReason::PayloadBound)
        ),
        "JSONB numeric expansion must be checked before handoff"
    );
    let reservations = (0..MAXIMUM_BYTES / MAXIMUM_WIRE_BYTES)
        .map(|_| sink.reserve(MAXIMUM_WIRE_BYTES))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_error| "preparation did not release admission permits")?;
    assert!(
        matches!(sink.reserve(1), Err(SkipReason::Capacity)),
        "all recovered byte permits remain bounded"
    );
    drop(reservations);
    transaction.rollback().await?;
    Ok(())
}
