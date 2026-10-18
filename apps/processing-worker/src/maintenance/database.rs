//! Connection evidence contains only hashes; credentials and raw target names stay local.

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio_postgres::Transaction;
use url::Url;

const INVALID_CONFIGURATION: &str = "maintenance database proof configuration is invalid";
const INVALID_LEDGER: &str = "maintenance database proof ledger is unavailable or invalid";

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseProof {
    format_version: u8,
    target_fingerprint: String,
    ledger_fingerprint: String,
}

pub(super) async fn inspect(
    transaction: &Transaction<'_>,
    database_url: &str,
) -> Result<DatabaseProof, &'static str> {
    let identity = transaction
        .query_one(
            "SELECT current_database(), current_setting('transaction_read_only') = 'on', \
             row_security_active('drizzle.__drizzle_migrations'::regclass)",
            &[],
        )
        .await
        .map_err(|_error| INVALID_LEDGER)?;
    let database = identity
        .try_get::<_, String>(0)
        .map_err(|_error| INVALID_LEDGER)?;
    if !identity
        .try_get::<_, bool>(1)
        .map_err(|_error| INVALID_LEDGER)?
        || identity
            .try_get::<_, bool>(2)
            .map_err(|_error| INVALID_LEDGER)?
    {
        return Err(INVALID_LEDGER);
    }
    let rows = transaction
        .query(
            "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
            &[],
        )
        .await
        .map_err(|_error| INVALID_LEDGER)?;
    let ledger = rows
        .iter()
        .map(|row| Ok((row.try_get::<_, String>(0)?, row.try_get::<_, String>(1)?)))
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()
        .map_err(|_error| INVALID_LEDGER)?;
    connection_proof(database_url, &database, &ledger)
}

fn connection_proof(
    database_url: &str,
    database: &str,
    ledger: &[(String, String)],
) -> Result<DatabaseProof, &'static str> {
    let target = Url::parse(database_url).map_err(|_error| INVALID_CONFIGURATION)?;
    if !matches!(target.scheme(), "postgres" | "postgresql") || database.is_empty() {
        return Err(INVALID_CONFIGURATION);
    }
    let mut host = target
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or(INVALID_CONFIGURATION)?
        .to_lowercase();
    if host.ends_with(".neon.tech")
        && let Some((first, rest)) = host.split_once('.')
        && let Some(endpoint) = first.strip_suffix("-pooler")
    {
        host = format!("{endpoint}.{rest}");
    }
    let port = target.port().unwrap_or(5432).to_string();
    let identity = serde_json::to_vec(&["momo-database-target-v1", &host, &port, database])
        .map_err(|_error| INVALID_CONFIGURATION)?;
    if ledger.is_empty() {
        return Err(INVALID_LEDGER);
    }
    let mut ordered = Sha256::new();
    ordered.update(b"momo-drizzle-ledger-v1\n");
    for (hash, created_at) in ledger {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
            || created_at.is_empty()
            || !created_at.bytes().all(|value| value.is_ascii_digit())
        {
            return Err(INVALID_LEDGER);
        }
        ordered.update(hash.as_bytes());
        ordered.update(b":");
        ordered.update(created_at.as_bytes());
        ordered.update(b"\n");
    }
    Ok(DatabaseProof {
        format_version: 1,
        target_fingerprint: hex::encode(Sha256::digest(identity)),
        ledger_fingerprint: hex::encode(ordered.finalize()),
    })
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "cross-runtime proof vectors must fail with the exact contract boundary"
)]
mod tests {
    use super::*;

    fn ledger() -> Vec<(String, String)> {
        vec![
            ("a".repeat(64), String::from("1730000000000")),
            ("b".repeat(64), String::from("1730000000001")),
        ]
    }

    #[test]
    fn proof_matches_shared_vectors_and_uses_the_connected_database() {
        let proof = connection_proof(
            "postgresql://role:secret@ep-fixture.example.neon.tech/configured",
            "actual",
            &ledger(),
        )
        .expect("valid shared vector must be accepted");
        assert_eq!(
            proof.target_fingerprint,
            "6771b0dca574fd57070c4e09362db28a2603f50c6a31c7ace1690390a4fa7169"
        );
        assert_eq!(
            proof.ledger_fingerprint,
            "6c999946c7604635b2672944e5bd546152a17281205cfb4429ed3df8d20cd5ab"
        );
        assert_eq!(
            connection_proof(
                "postgres://other:changed@EP-FIXTURE-pooler.example.neon.tech:5432/ignored",
                "actual",
                &ledger(),
            )
            .expect("role, configured path and canonical pooler alias do not identify the target"),
            proof
        );
        for (url, database) in [
            (
                "postgresql://ep-fixture.example.neon.tech:5433/configured",
                "actual",
            ),
            (
                "postgresql://ep-fixture.example.neon.tech/configured",
                "other",
            ),
            (
                "postgresql://ep-fixture-pooler.example.neon.tech.invalid/configured",
                "actual",
            ),
        ] {
            assert_ne!(
                connection_proof(url, database, &ledger())
                    .expect("changed targets are well formed")
                    .target_fingerprint,
                proof.target_fingerprint
            );
        }
        let mut reordered = ledger();
        reordered.reverse();
        assert_ne!(
            connection_proof(
                "postgresql://ep-fixture.example.neon.tech/configured",
                "actual",
                &reordered
            )
            .expect("ordered ledger vector is valid")
            .ledger_fingerprint,
            proof.ledger_fingerprint
        );
    }

    #[test]
    fn empty_or_malformed_ledger_cannot_become_evidence() {
        for rows in [
            Vec::new(),
            vec![("A".repeat(64), String::from("1"))],
            vec![("a".repeat(63), String::from("1"))],
            vec![("a".repeat(64), String::from("-1"))],
            vec![("a".repeat(64), String::new())],
        ] {
            assert_eq!(
                connection_proof("postgresql://fixture.invalid/db", "db", &rows),
                Err(INVALID_LEDGER)
            );
        }
        assert_eq!(
            connection_proof("https://fixture.invalid/db", "db", &ledger()),
            Err(INVALID_CONFIGURATION)
        );
    }
}
