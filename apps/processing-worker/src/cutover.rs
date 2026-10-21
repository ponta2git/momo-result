//! Read-only boot boundary; never constructs the worker scheduler or delivery runtime.
use std::{
    collections::BTreeMap, fs::OpenOptions, io::Write, os::unix::fs::OpenOptionsExt, path::PathBuf,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

const PREFIX: &str = "MOMO_CUTOVER_";

pub(crate) fn enabled() -> Result<bool, String> {
    mode(&std::env::vars().collect())
}

fn mode(env: &BTreeMap<String, String>) -> Result<bool, String> {
    match env.get("MOMO_CUTOVER_MODE").map(String::as_str) {
        None if !env.keys().any(|key| key.starts_with(PREFIX)) => Ok(false),
        Some("maintenance") => Ok(true),
        _ => Err("invalid cutover execution mode".to_owned()),
    }
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(format!("{PREFIX}{name}"))
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "missing cutover setting".to_owned())
}

#[derive(Serialize)]
struct LedgerRow {
    hash: String,
    created_at: String,
}

pub(crate) async fn run() -> Result<(), String> {
    if !crate::process::worker_identity_supported() {
        return Err("maintenance requires the fixed worker identity".to_owned());
    }
    let expected_database = required("EXPECTED_DATABASE")?;
    let expected_role = required("EXPECTED_ROLE")?;
    let expected_ledger = required("EXPECTED_LEDGER_SHA256")?;
    let image = required("IMAGE_DIGEST")?;
    let report = PathBuf::from(required("REPORT_PATH")?);
    if !valid_hash(&expected_ledger)
        || !image.strip_prefix("sha256:").is_some_and(valid_hash)
        || !report.is_absolute()
    {
        return Err("invalid cutover settings".to_owned());
    }
    let url = std::env::var("DATABASE_URL").map_err(|_error| "database required")?;
    let mut client = crate::postgres::connect_unchecked(&url)
        .await
        .map_err(|_error| "cutover connection failed")?;
    let transaction = client
        .build_transaction()
        .read_only(true)
        .start()
        .await
        .map_err(|_error| "cutover transaction failed")?;
    transaction
        .batch_execute("SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '2s'")
        .await
        .map_err(|_error| "cutover timeout setup failed")?;
    let identity = transaction.query_one("SELECT current_database(), current_user::text, session_user::text, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')", &[]).await.map_err(|_error| "cutover identity query failed")?;
    let database: String = identity.get(0);
    let role: String = identity.get(1);
    let login_role: String = identity.get(2);
    let observed_at: String = identity.get(3);
    let rows = transaction
        .query(
            "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
            &[],
        )
        .await
        .map_err(|_error| "cutover ledger query failed")?;
    let ledger: Vec<LedgerRow> = rows
        .iter()
        .map(|row| LedgerRow {
            hash: row.get(0),
            created_at: row.get(1),
        })
        .collect();
    let encoded = serde_json::to_vec(&ledger).map_err(|_error| "cutover ledger encoding failed")?;
    let hash = hex::encode(Sha256::digest(&encoded));
    if database != expected_database
        || role != expected_role
        || login_role != role
        || hash != expected_ledger
    {
        return Err("cutover database identity mismatch".to_owned());
    }
    transaction
        .rollback()
        .await
        .map_err(|_error| "cutover transaction close failed")?;
    drop(client);
    let boot_id = format!("{}-{}", std::process::id(), observed_at);
    let evidence = serde_json::json!({
        "formatVersion": 1, "consumer": "worker", "mode": "maintenance", "observedAt": observed_at,
        "role": role, "database": database, "ledger": ledger, "readOnly": true,
        "machine": { "id": std::env::var("FLY_MACHINE_ID").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "local".to_owned()),
            "bootId": boot_id, "imageDigest": image }
    });
    let temporary = report.with_extension(format!("{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_error| "cutover report creation failed")?;
    file.write_all(
        &serde_json::to_vec(&evidence).map_err(|_error| "cutover report encoding failed")?,
    )
    .map_err(|_error| "cutover report write failed")?;
    file.sync_all()
        .map_err(|_error| "cutover report sync failed")?;
    std::fs::rename(&temporary, &report).map_err(|_error| "cutover report publish failed")?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_error| "cutover signal setup failed")?;
    tokio::select! { _ = terminate.recv() => {}, result = tokio::signal::ctrl_c() => { result.map_err(|_error| "cutover signal failed")?; } }
    Ok(())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ambiguous_mode_never_falls_back_to_active() {
        assert_eq!(mode(&BTreeMap::new()), Ok(false));
        for value in ["", "false", "active", "maintenence"] {
            assert!(
                mode(&BTreeMap::from([(
                    "MOMO_CUTOVER_MODE".to_owned(),
                    value.to_owned()
                )]))
                .is_err()
            );
        }
        assert!(
            mode(&BTreeMap::from([(
                "MOMO_CUTOVER_IMAGE_DIGEST".to_owned(),
                "x".to_owned()
            )]))
            .is_err()
        );
        assert_eq!(
            mode(&BTreeMap::from([(
                "MOMO_CUTOVER_MODE".to_owned(),
                "maintenance".to_owned()
            )])),
            Ok(true)
        );
    }
}
