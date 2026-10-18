//! Frozen startup and read-only readiness, independent of normal worker construction.

pub(crate) mod analysis;
mod database;
pub(crate) mod drain;

pub(crate) use database::DatabaseProof;

use std::{ffi::OsStr, time::Duration};

use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Mode {
    Normal,
    Frozen,
}

impl Mode {
    pub(crate) fn from_environment() -> Result<Self, &'static str> {
        Self::parse(std::env::var_os("MOMO_MAINTENANCE_MODE").as_deref())
    }

    fn parse(value: Option<&OsStr>) -> Result<Self, &'static str> {
        match value {
            None => Ok(Self::Normal),
            Some(value) if value == "normal" => Ok(Self::Normal),
            Some(value) if value == "frozen" => Ok(Self::Frozen),
            Some(_) => Err("MOMO_MAINTENANCE_MODE must be normal or frozen"),
        }
    }
}

pub(crate) async fn readiness(database_url: &str) -> Result<DatabaseProof, &'static str> {
    tokio::time::timeout(Duration::from_secs(20), check_database(database_url))
        .await
        .map_err(|_elapsed| "maintenance readiness timed out")?
}

async fn check_database(database_url: &str) -> Result<DatabaseProof, &'static str> {
    let mut client = crate::postgres::connect(database_url)
        .await
        .map_err(|_error| "maintenance database connection failed")?;
    let transaction = client
        .build_transaction()
        .read_only(true)
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .start()
        .await
        .map_err(|_error| "maintenance read-only transaction failed")?;
    transaction
        .batch_execute("SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '3s'")
        .await
        .map_err(|_error| "maintenance read-only transaction failed")?;
    let database = database::inspect(&transaction, database_url).await?;
    let schema_version = i32::try_from(ARTIFACT_SCHEMA_VERSION)
        .map_err(|_error| "maintenance reader contract is invalid")?;
    let row = transaction
        .query_opt(
            "SELECT artifact_schema_version = $1 AND validation_contract_id IS NOT DISTINCT FROM $2 \
             FROM series_analysis_release_state WHERE singleton_key = 'current'",
            &[&schema_version, &ARTIFACT_VALIDATION_CONTRACT_ID],
        )
        .await
        .map_err(|_error| "maintenance schema query failed")?;
    let compatible = row
        .map(|row| row.try_get::<_, bool>(0))
        .transpose()
        .map_err(|_error| "maintenance schema query failed")?
        .unwrap_or(true);
    transaction
        .rollback()
        .await
        .map_err(|_error| "maintenance read-only transaction failed")?;
    if compatible {
        Ok(database)
    } else {
        Err("maintenance reader contract is incompatible")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maintenance_mode_is_strict_and_defaults_only_when_absent() {
        assert_eq!(
            Mode::parse(None),
            Ok(Mode::Normal),
            "unset must preserve normal operation"
        );
        assert_eq!(
            Mode::parse(Some(OsStr::new("normal"))),
            Ok(Mode::Normal),
            "normal must be explicit"
        );
        assert_eq!(
            Mode::parse(Some(OsStr::new("frozen"))),
            Ok(Mode::Frozen),
            "frozen must be explicit"
        );
        for value in [
            "",
            "NORMAL",
            " frozen",
            "frozen ",
            "drain",
            "invalid-secret",
        ] {
            assert_eq!(
                Mode::parse(Some(OsStr::new(value))),
                Err("MOMO_MAINTENANCE_MODE must be normal or frozen"),
                "unknown mode must fail without echoing its value"
            );
        }
    }
}
