//! Non-locking candidate discovery. Claims revalidate under slot -> title/draft -> job locks.
use super::{PostCommitSink, runtime::WorkerError};
use crate::{
    execution_slot::{self, ExecutionSlotHolder, ExecutionTaskKind},
    series_analysis::control::ALGORITHM_VERSION,
};
use momo_analysis_core::contract::{ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID};
use std::time::{Duration, SystemTime};
use tokio_postgres::Client;

const PAGE: i64 = 64;

#[derive(Clone, Debug)]
pub(super) struct Cursor {
    pub(super) id: String,
    available_at: SystemTime,
    requested_at: SystemTime,
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
        client.query("SELECT id,available_at,created_at FROM ocr_jobs WHERE status='queued' AND available_at <= statement_timestamp() AND ($2::timestamptz IS NULL OR (available_at,created_at,id)>($2,$3,$4)) ORDER BY available_at,created_at,id LIMIT $1", &[&PAGE,&available,&requested,&id]).await?
    } else {
        let schema = i64::from(ARTIFACT_SCHEMA_VERSION);
        client.query("SELECT id,available_at,requested_at FROM series_analysis_jobs WHERE status='queued' AND available_at <= statement_timestamp() AND ($2::timestamptz IS NULL OR (available_at,requested_at,id)>($2,$3,$4)) AND algorithm_version=$5 AND artifact_schema_version=$6::bigint::integer AND validation_contract_id=$7 ORDER BY available_at,requested_at,id LIMIT $1", &[&PAGE,&available,&requested,&id,&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID]).await?
    };
    rows.iter()
        .map(|row| {
            Ok(Cursor {
                id: row.try_get(0)?,
                available_at: row.try_get(1)?,
                requested_at: row.try_get(2)?,
            })
        })
        .collect()
}

pub(super) async fn next_due(
    client: &Client,
    include_ocr: bool,
    maximum: Duration,
) -> Result<Duration, tokio_postgres::Error> {
    let schema = i64::from(ARTIFACT_SCHEMA_VERSION);
    let row = client.query_one("SELECT EXTRACT(EPOCH FROM MIN(due)-statement_timestamp())::double precision FROM (SELECT available_at AS due FROM series_analysis_jobs WHERE status='queued' AND available_at > statement_timestamp() AND algorithm_version=$1 AND artifact_schema_version=$2::bigint::integer AND validation_contract_id=$3 UNION ALL SELECT available_at FROM ocr_jobs WHERE $4 AND status='queued' AND available_at > statement_timestamp() UNION ALL SELECT lease_expires_at FROM worker_execution_slots WHERE lease_expires_at > statement_timestamp()) d", &[&ALGORITHM_VERSION,&schema,&ARTIFACT_VALIDATION_CONTRACT_ID,&include_ocr]).await?;
    let seconds: Option<f64> = row.try_get(0)?;
    Ok(seconds
        .and_then(|seconds| Duration::try_from_secs_f64(seconds.max(0.0)).ok())
        .map_or(maximum, |delay| delay.min(maximum)))
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
    match recover_slot(client, sink, maximum_recoveries).await {
        Ok(()) => {}
        Err(error) if error.is_contention() => {
            return Ok(RecoveryProgress {
                more: false,
                deferred: true,
            });
        }
        Err(error) => return Err(error),
    }
    let kind = after.as_ref().map(|cursor| cursor.0.as_str());
    let id = after.as_ref().map(|cursor| cursor.1.as_str());
    let rows=client.query("SELECT * FROM (SELECT 'analysis'::text AS kind,id,lease_owner,lease_attempt_id,lease_fencing_token FROM series_analysis_jobs WHERE status='running' AND lease_expires_at<=clock_timestamp() UNION ALL SELECT 'ocr',id,lease_owner,attempt_id::text,lease_fencing_token FROM ocr_jobs WHERE status='running' AND lease_expires_at<=clock_timestamp()) orphan WHERE ($1::text IS NULL OR (kind,id)>($1,$2)) ORDER BY kind,id LIMIT 64", &[&kind,&id]).await?;
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

async fn recover_slot(
    client: &mut Client,
    sink: &PostCommitSink,
    maximum_recoveries: i32,
) -> Result<(), WorkerError> {
    let tx = client.transaction().await?;
    tx.batch_execute("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='100ms'")
        .await?;
    let slot = execution_slot::lock(&tx).await?;
    if let Some(holder) = &slot.holder {
        if holder.expired {
            if holder.task_kind == ExecutionTaskKind::Ocr {
                crate::ocr::control::lock_match_drafts_for_job(&tx, &holder.job_id).await?;
            }
            let effects = crate::ocr::control::recovery::recover_expired_holder(
                &tx,
                holder,
                maximum_recoveries,
            )
            .await?;
            tx.commit().await?;
            sink.submit(effects.committed(()).effects)?;
        } else {
            tx.rollback().await?;
        }
    } else {
        execution_slot::clear_stale_preemption(&tx, 1).await?;
        tx.commit().await?;
    }
    Ok(())
}

async fn recover_orphan(
    client: &mut Client,
    sink: &PostCommitSink,
    maximum_recoveries: i32,
    row: &tokio_postgres::Row,
) -> Result<(), WorkerError> {
    let kind: String = row.try_get(0)?;
    let holder = ExecutionSlotHolder {
        task_kind: if kind == "ocr" {
            ExecutionTaskKind::Ocr
        } else {
            ExecutionTaskKind::Analysis
        },
        job_id: row.try_get(1)?,
        owner: row.try_get(2)?,
        attempt_id: row.try_get(3)?,
        fencing_token: row.try_get(4)?,
        preemptible: true,
        expired: true,
    };
    let tx = client.transaction().await?;
    tx.batch_execute("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='10ms'")
        .await?;
    let slot = execution_slot::lock(&tx).await?;
    if slot.holder.as_ref().is_some_and(|current| {
        current.job_id == holder.job_id && current.task_kind == holder.task_kind
    }) {
        tx.rollback().await?;
        return Ok(());
    }
    let valid = if holder.task_kind == ExecutionTaskKind::Ocr {
        tx.query_opt("SELECT id FROM ocr_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND attempt_id::text=$3 AND lease_fencing_token=$4 AND lease_expires_at<=clock_timestamp()", &[&holder.job_id,&holder.owner,&holder.attempt_id,&holder.fencing_token]).await?.is_some()
    } else {
        tx.query_opt("SELECT id FROM series_analysis_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_attempt_id=$3 AND lease_fencing_token=$4 AND lease_expires_at<=clock_timestamp()", &[&holder.job_id,&holder.owner,&holder.attempt_id,&holder.fencing_token]).await?.is_some()
    };
    if !valid {
        tx.rollback().await?;
        return Ok(());
    }
    let effects = if holder.task_kind == ExecutionTaskKind::Ocr {
        crate::ocr::control::lock_match_drafts_for_job(&tx, &holder.job_id).await?;
        crate::ocr::control::recovery::recover_expired_ocr_holder(
            &tx,
            &holder,
            maximum_recoveries,
            false,
        )
        .await?;
        crate::series_analysis::control::TransactionEffects::default()
    } else {
        crate::series_analysis::control::recovery::recover_expired_analysis_job(&tx, &holder, false)
            .await?
    };
    tx.commit().await?;
    sink.submit(effects.committed(()).effects)?;
    Ok(())
}

#[cfg(test)]
#[path = "selection_tests.rs"]
mod selection_tests;
