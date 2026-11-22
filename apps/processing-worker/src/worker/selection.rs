//! Non-locking candidate discovery. Claims revalidate under title/draft -> job locks.
use super::{PostCommitSink, runtime::WorkerError};
use crate::{job_lease::ExpiredJobLease, series_analysis::control::ALGORITHM_VERSION};
use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use std::time::{Duration, SystemTime};
use tokio::time::Instant;
use tokio_postgres::{Client, Row, types::Type};

pub(super) const PAGE: u16 = 64;

#[derive(Clone, Debug)]
pub(super) struct Cursor {
    pub(super) id: String,
    available_at: SystemTime,
    requested_at: SystemTime,
}

impl Cursor {
    fn from_row(row: &Row) -> Result<Self, tokio_postgres::Error> {
        Ok(Self {
            id: row.try_get(0)?,
            available_at: row.try_get(1)?,
            requested_at: row.try_get(2)?,
        })
    }
}

pub(super) enum FirstScan {
    Ocr(Vec<Cursor>),
    Analysis(Vec<Cursor>),
    Idle(Option<Instant>),
}

// Only visit the lower-priority queue when OCR is empty. The scalar deadline query
// runs only for the idle row, using the same database snapshot as both queues.
const FIRST_SCAN: &str = concat!(
    r"
    WITH ocr_page AS MATERIALIZED (
        SELECT legacy_id, available_at, created_at AS requested_at
        FROM ocr_jobs
        WHERE $4 AND status = 'queued' AND available_at <= statement_timestamp()
        ORDER BY available_at, created_at, legacy_id LIMIT $7
    ), candidates AS MATERIALIZED (
        SELECT legacy_id, available_at, requested_at, true AS ocr FROM ocr_page
        UNION ALL
        (SELECT legacy_id, available_at, requested_at, false FROM series_analysis_jobs
         WHERE $5 AND NOT EXISTS (SELECT FROM ocr_page)
           AND status = 'queued' AND available_at <= statement_timestamp()
           AND algorithm_version = $1 AND artifact_schema_version = $2::bigint::integer AND validation_contract_id = $3
         ORDER BY available_at, requested_at, legacy_id LIMIT $7)
    )
    SELECT legacy_id, available_at, requested_at, ocr, NULL::double precision FROM candidates
    UNION ALL
    SELECT NULL, NULL, NULL, NULL, (",
    include_str!("next_due.sql"),
    ") WHERE NOT EXISTS (SELECT FROM candidates)
    ORDER BY available_at, requested_at, legacy_id"
);

pub(super) async fn first_scan(
    client: &Client,
    ocr: bool,
    analysis: bool,
    ocr_stale_after: Duration,
) -> Result<FirstScan, tokio_postgres::Error> {
    let started = Instant::now();
    let schema = i64::from(ARTIFACT_SCHEMA_VERSION);
    let rows = client
        .query_typed(
            FIRST_SCAN,
            &[
                (&ALGORITHM_VERSION, Type::TEXT),
                (&schema, Type::INT8),
                (&ARTIFACT_VALIDATION_CONTRACT_ID, Type::TEXT),
                (&ocr, Type::BOOL),
                (&analysis, Type::BOOL),
                (&ocr_stale_after.as_secs_f64(), Type::FLOAT8),
                (&i64::from(PAGE), Type::INT8),
            ],
        )
        .await?;
    let Some(first) = rows.first() else {
        return Ok(FirstScan::Idle(None));
    };
    match first.try_get::<_, Option<bool>>(3)? {
        Some(is_ocr) => {
            let jobs = rows
                .iter()
                .map(Cursor::from_row)
                .collect::<Result<_, _>>()?;
            Ok(if is_ocr {
                FirstScan::Ocr(jobs)
            } else {
                FirstScan::Analysis(jobs)
            })
        }
        None => Ok(FirstScan::Idle(wake_at(started, first.try_get(4)?))),
    }
}

pub(super) async fn candidates(
    client: &Client,
    ocr: bool,
    after: Option<&Cursor>,
) -> Result<Vec<Cursor>, tokio_postgres::Error> {
    let available = after.map(|cursor| cursor.available_at);
    let requested = after.map(|cursor| cursor.requested_at);
    let id = after.map(|cursor| cursor.id.as_str());
    let rows = if ocr {
        client.query("SELECT legacy_id,available_at,created_at FROM ocr_jobs WHERE status='queued' AND available_at <= statement_timestamp() AND ($2::timestamptz IS NULL OR (available_at,created_at,legacy_id)>($2,$3,$4)) ORDER BY available_at,created_at,legacy_id LIMIT $1", &[&i64::from(PAGE),&available,&requested,&id]).await?
    } else {
        let schema = i64::from(ARTIFACT_SCHEMA_VERSION);
        client.query("SELECT legacy_id,available_at,requested_at FROM series_analysis_jobs WHERE status='queued' AND available_at <= statement_timestamp() AND ($2::timestamptz IS NULL OR (available_at,requested_at,legacy_id)>($2,$3,$4)) AND algorithm_version=$5 AND artifact_schema_version=$6::bigint::integer AND validation_contract_id=$7 ORDER BY available_at,requested_at,legacy_id LIMIT $1", &[&i64::from(PAGE),&available,&requested,&id,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?
    };
    rows.iter().map(Cursor::from_row).collect()
}

pub(super) async fn next_due(
    client: &Client,
    ocr: bool,
    analysis: bool,
    ocr_stale_after: Duration,
) -> Result<Option<Instant>, tokio_postgres::Error> {
    let started = Instant::now();
    let schema = i64::from(ARTIFACT_SCHEMA_VERSION);
    let row = client
        .query_typed_one(
            include_str!("next_due.sql"),
            &[
                (&ALGORITHM_VERSION, Type::TEXT),
                (&schema, Type::INT8),
                (&ARTIFACT_VALIDATION_CONTRACT_ID, Type::TEXT),
                (&ocr, Type::BOOL),
                (&analysis, Type::BOOL),
                (&ocr_stale_after.as_secs_f64(), Type::FLOAT8),
            ],
        )
        .await?;
    Ok(wake_at(started, row.try_get(0)?))
}

// Derive the interval on the DB clock. Time already spent waiting for its reply
// counts toward the local monotonic deadline.
fn wake_at(started: Instant, seconds: Option<f64>) -> Option<Instant> {
    let delay = Duration::try_from_secs_f64(seconds?.max(0.0)).ok()?;
    started.checked_add(delay)
}

pub(super) type RecoveryCursor = (String, String);
pub(super) struct RecoveryProgress {
    pub(super) more: bool,
    pub(super) deferred: bool,
}

#[cfg(test)]
pub(super) async fn recover(
    client: &mut Client,
    sink: &PostCommitSink,
    maximum_recoveries: i32,
) -> Result<(), WorkerError> {
    recover_page(client, sink, maximum_recoveries, &mut None)
        .await
        .map(|_| ())
}

pub(super) async fn recover_page(
    client: &mut Client,
    sink: &PostCommitSink,
    maximum_recoveries: i32,
    after: &mut Option<RecoveryCursor>,
) -> Result<RecoveryProgress, WorkerError> {
    let kind = after.as_ref().map(|cursor| cursor.0.as_str());
    let id = after.as_ref().map(|cursor| cursor.1.as_str());
    let rows=client.query("SELECT * FROM (SELECT 'analysis'::text AS kind,legacy_id AS id,lease_owner,legacy_lease_attempt_id,lease_fencing_token FROM series_analysis_jobs WHERE status='running' AND lease_expires_at<=clock_timestamp() UNION ALL SELECT 'ocr',legacy_id,lease_owner,attempt_id::text,lease_fencing_token FROM ocr_jobs WHERE status='running' AND lease_expires_at<=clock_timestamp()) orphan WHERE ($1::text IS NULL OR (kind,id)>($1,$2)) ORDER BY kind,id LIMIT 64", &[&kind,&id]).await?;
    let more = rows.len() == 64;
    let mut deferred = false;
    for row in rows {
        *after = Some((row.try_get(0)?, row.try_get(1)?));
        match recover_orphan(client, sink, maximum_recoveries, &row).await {
            Ok(()) => {}
            Err(error) if error.is_contention() => deferred = true,
            Err(error) => return Err(error),
        }
    }
    if !more {
        *after = None;
    }
    Ok(RecoveryProgress { more, deferred })
}

async fn recover_orphan(
    client: &mut Client,
    sink: &PostCommitSink,
    maximum_recoveries: i32,
    row: &Row,
) -> Result<(), WorkerError> {
    let kind: String = row.try_get(0)?;
    let holder = ExpiredJobLease {
        job_id: row.try_get(1)?,
        owner: row.try_get(2)?,
        attempt_id: row.try_get(3)?,
        fencing_token: row.try_get(4)?,
    };
    let tx = client.transaction().await?;
    tx.batch_execute("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='10ms'")
        .await?;
    let effects = if kind == "ocr" {
        crate::ocr::control::lock_match_drafts_for_job(&tx, &holder.job_id).await?;
        crate::ocr::control::recovery::recover_expired_ocr_holder(&tx, &holder, maximum_recoveries)
            .await?;
        crate::series_analysis::control::TransactionEffects::default()
    } else {
        crate::series_analysis::control::recovery::recover_expired_analysis_job(&tx, &holder)
            .await?
    };
    tx.commit().await?;
    let wake = if kind == "ocr" {
        super::PostCommitEffects::WakeJobs
    } else {
        effects.committed(()).effects
    };
    sink.submit(wake)?;
    Ok(())
}

#[cfg(test)]
#[path = "selection_tests.rs"]
mod selection_tests;
