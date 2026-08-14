use thiserror::Error;
use tokio_postgres::{Row, Transaction};

const SLOT_KEY: &str = "shared-heavy-work";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExecutionTaskKind {
    Analysis,
    Ocr,
}

impl ExecutionTaskKind {
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Analysis => "analysis",
            Self::Ocr => "ocr",
        }
    }

    fn parse(value: &str) -> Result<Self, ExecutionSlotError> {
        match value {
            "analysis" => Ok(Self::Analysis),
            "ocr" => Ok(Self::Ocr),
            _ => Err(ExecutionSlotError::InvalidState),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExecutionSlotHolder {
    pub(crate) task_kind: ExecutionTaskKind,
    pub(crate) owner: String,
    pub(crate) job_id: String,
    pub(crate) attempt_id: String,
    pub(crate) preemptible: bool,
    pub(crate) fencing_token: i64,
    pub(crate) expired: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LockedExecutionSlot {
    pub(crate) holder: Option<ExecutionSlotHolder>,
    pub(crate) fencing_token: i64,
    pub(crate) preempt_requested_by: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ExecutionSlotIdentity<'a> {
    pub(crate) task_kind: ExecutionTaskKind,
    pub(crate) owner: &'a str,
    pub(crate) job_id: &'a str,
    pub(crate) attempt_id: &'a str,
    pub(crate) fencing_token: i64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct NewExecutionSlotHolder<'a> {
    pub(crate) owner: &'a str,
    pub(crate) job_id: &'a str,
    pub(crate) attempt_id: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SlotAcquisition {
    Acquired(i64),
    Busy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SlotRenewal {
    Continue,
    PreemptRequested,
    OwnerLost,
}

#[derive(Debug, Error)]
pub(crate) enum ExecutionSlotError {
    #[error("shared execution-slot database operation failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("shared execution-slot row violates its closed state contract")]
    InvalidState,
}

impl ExecutionSlotError {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Postgres(_) => "execution_slot_postgres",
            Self::InvalidState => "execution_slot_invalid_state",
        }
    }
}

pub(crate) async fn lock(
    transaction: &Transaction<'_>,
) -> Result<LockedExecutionSlot, ExecutionSlotError> {
    let row = transaction
        .query_one(
            "SELECT task_kind, owner, job_id, attempt_id, holder_preemptible, fencing_token,\x20\
                    lease_expires_at <= clock_timestamp(), preempt_requested_by\x20\
             FROM worker_execution_slots WHERE slot_key = $1 FOR UPDATE",
            &[&SLOT_KEY],
        )
        .await?;
    decode_locked_slot(&row)
}

fn decode_locked_slot(row: &Row) -> Result<LockedExecutionSlot, ExecutionSlotError> {
    let task_kind = row.try_get::<_, Option<String>>(0)?;
    let owner = row.try_get::<_, Option<String>>(1)?;
    let job_id = row.try_get::<_, Option<String>>(2)?;
    let attempt_id = row.try_get::<_, Option<String>>(3)?;
    let preemptible = row.try_get::<_, Option<bool>>(4)?;
    let fencing_token = row.try_get::<_, i64>(5)?;
    let expired = row.try_get::<_, Option<bool>>(6)?;
    let preempt_requested_by = row.try_get::<_, Option<String>>(7)?;
    if fencing_token < 0 {
        return Err(ExecutionSlotError::InvalidState);
    }
    let holder = match (task_kind, owner, job_id, attempt_id, preemptible, expired) {
        (None, None, None, None, None, None) => None,
        (
            Some(task_kind),
            Some(owner),
            Some(job_id),
            Some(attempt_id),
            Some(preemptible),
            Some(expired),
        ) if fencing_token >= 1 => {
            let task_kind = ExecutionTaskKind::parse(&task_kind)?;
            if preemptible != (task_kind == ExecutionTaskKind::Analysis) {
                return Err(ExecutionSlotError::InvalidState);
            }
            Some(ExecutionSlotHolder {
                task_kind,
                owner,
                job_id,
                attempt_id,
                preemptible,
                fencing_token,
                expired,
            })
        }
        _ => return Err(ExecutionSlotError::InvalidState),
    };
    if preempt_requested_by
        .as_deref()
        .is_some_and(|requester| !valid_runtime_identifier(requester))
        || holder.as_ref().is_some_and(|holder| {
            holder.task_kind == ExecutionTaskKind::Ocr && preempt_requested_by.is_some()
        })
    {
        return Err(ExecutionSlotError::InvalidState);
    }
    Ok(LockedExecutionSlot {
        holder,
        fencing_token,
        preempt_requested_by,
    })
}

pub(crate) async fn acquire_analysis(
    transaction: &Transaction<'_>,
    expected_fencing_token: i64,
    holder: NewExecutionSlotHolder<'_>,
    lease_milliseconds: i64,
) -> Result<SlotAcquisition, ExecutionSlotError> {
    acquire(
        transaction,
        expected_fencing_token,
        holder,
        lease_milliseconds,
        ExecutionTaskKind::Analysis,
    )
    .await
}

pub(crate) async fn acquire_ocr(
    transaction: &Transaction<'_>,
    expected_fencing_token: i64,
    holder: NewExecutionSlotHolder<'_>,
    lease_milliseconds: i64,
) -> Result<SlotAcquisition, ExecutionSlotError> {
    acquire(
        transaction,
        expected_fencing_token,
        holder,
        lease_milliseconds,
        ExecutionTaskKind::Ocr,
    )
    .await
}

async fn acquire(
    transaction: &Transaction<'_>,
    expected_fencing_token: i64,
    holder: NewExecutionSlotHolder<'_>,
    lease_milliseconds: i64,
    task_kind: ExecutionTaskKind,
) -> Result<SlotAcquisition, ExecutionSlotError> {
    let task_kind_wire = task_kind.wire();
    let row = match task_kind {
        ExecutionTaskKind::Analysis => {
            transaction
                .query_opt(
                    "UPDATE worker_execution_slots SET task_kind = $1, owner = $2, job_id = $3,\x20\
                       attempt_id = $4, holder_preemptible = true,\x20\
                       lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),\x20\
                       fencing_token = fencing_token + 1, updated_at = clock_timestamp()\x20\
                     WHERE slot_key = $6 AND owner IS NULL AND preempt_requested_by IS NULL\x20\
                       AND fencing_token = $7 RETURNING fencing_token",
                    &[
                        &task_kind_wire,
                        &holder.owner,
                        &holder.job_id,
                        &holder.attempt_id,
                        &lease_milliseconds,
                        &SLOT_KEY,
                        &expected_fencing_token,
                    ],
                )
                .await?
        }
        ExecutionTaskKind::Ocr => {
            transaction
                .query_opt(
                    "UPDATE worker_execution_slots SET task_kind = $1, owner = $2, job_id = $3,\x20\
                       attempt_id = $4, holder_preemptible = false,\x20\
                       lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),\x20\
                       fencing_token = fencing_token + 1, preempt_requested_by = NULL,\x20\
                       preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
                     WHERE slot_key = $6 AND owner IS NULL AND fencing_token = $7\x20\
                     RETURNING fencing_token",
                    &[
                        &task_kind_wire,
                        &holder.owner,
                        &holder.job_id,
                        &holder.attempt_id,
                        &lease_milliseconds,
                        &SLOT_KEY,
                        &expected_fencing_token,
                    ],
                )
                .await?
        }
    };
    row.map_or(Ok(SlotAcquisition::Busy), |row| {
        row.try_get(0)
            .map(SlotAcquisition::Acquired)
            .map_err(ExecutionSlotError::Postgres)
    })
}

pub(crate) async fn renew_owned(
    transaction: &Transaction<'_>,
    identity: ExecutionSlotIdentity<'_>,
    lease_milliseconds: i64,
) -> Result<SlotRenewal, ExecutionSlotError> {
    let task_kind = identity.task_kind.wire();
    let row = transaction
        .query_opt(
            "UPDATE worker_execution_slots SET\x20\
               lease_expires_at = clock_timestamp() + ($1::bigint * interval '1 millisecond'),\x20\
               updated_at = clock_timestamp()\x20\
             WHERE slot_key = $2 AND task_kind = $3 AND owner = $4 AND job_id = $5\x20\
               AND attempt_id = $6 AND fencing_token = $7\x20\
               AND lease_expires_at > clock_timestamp() RETURNING preempt_requested_by",
            &[
                &lease_milliseconds,
                &SLOT_KEY,
                &task_kind,
                &identity.owner,
                &identity.job_id,
                &identity.attempt_id,
                &identity.fencing_token,
            ],
        )
        .await?;
    let Some(row) = row else {
        return Ok(SlotRenewal::OwnerLost);
    };
    Ok(if row.try_get::<_, Option<String>>(0)?.is_some() {
        SlotRenewal::PreemptRequested
    } else {
        SlotRenewal::Continue
    })
}

pub(crate) async fn lock_owned(
    transaction: &Transaction<'_>,
    identity: ExecutionSlotIdentity<'_>,
) -> Result<bool, ExecutionSlotError> {
    let task_kind = identity.task_kind.wire();
    Ok(transaction
        .query_opt(
            "SELECT 1 FROM worker_execution_slots WHERE slot_key = $1 AND task_kind = $2\x20\
               AND owner = $3 AND job_id = $4 AND attempt_id = $5 AND fencing_token = $6\x20\
               AND lease_expires_at > clock_timestamp() FOR UPDATE",
            &[
                &SLOT_KEY,
                &task_kind,
                &identity.owner,
                &identity.job_id,
                &identity.attempt_id,
                &identity.fencing_token,
            ],
        )
        .await?
        .is_some())
}

pub(crate) async fn release_owned(
    transaction: &Transaction<'_>,
    identity: ExecutionSlotIdentity<'_>,
) -> Result<bool, ExecutionSlotError> {
    let task_kind = identity.task_kind.wire();
    let released = transaction
        .execute(
            "UPDATE worker_execution_slots SET\x20\
               preempt_requested_at = CASE WHEN task_kind = 'analysis'\x20\
                 AND preempt_requested_by IS NOT NULL THEN clock_timestamp()\x20\
                 ELSE preempt_requested_at END, task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               updated_at = clock_timestamp()\x20\
             WHERE slot_key = $1 AND task_kind = $2 AND owner = $3 AND job_id = $4\x20\
               AND attempt_id = $5 AND fencing_token = $6",
            &[
                &SLOT_KEY,
                &task_kind,
                &identity.owner,
                &identity.job_id,
                &identity.attempt_id,
                &identity.fencing_token,
            ],
        )
        .await?;
    Ok(released == 1)
}

pub(crate) async fn clear_expired(
    transaction: &Transaction<'_>,
    holder: &ExecutionSlotHolder,
) -> Result<bool, ExecutionSlotError> {
    let task_kind = holder.task_kind.wire();
    let cleared = transaction
        .execute(
            "UPDATE worker_execution_slots SET\x20\
               preempt_requested_at = CASE WHEN task_kind = 'analysis'\x20\
                 AND preempt_requested_by IS NOT NULL THEN clock_timestamp()\x20\
                 ELSE preempt_requested_at END, task_kind = NULL, owner = NULL, job_id = NULL,\x20\
               attempt_id = NULL, holder_preemptible = NULL, lease_expires_at = NULL,\x20\
               updated_at = clock_timestamp()\x20\
             WHERE slot_key = $1 AND task_kind = $2 AND owner = $3 AND job_id = $4\x20\
               AND attempt_id = $5 AND fencing_token = $6\x20\
               AND lease_expires_at <= clock_timestamp()",
            &[
                &SLOT_KEY,
                &task_kind,
                &holder.owner,
                &holder.job_id,
                &holder.attempt_id,
                &holder.fencing_token,
            ],
        )
        .await?;
    Ok(cleared == 1)
}

pub(crate) async fn clear_stale_preemption(
    transaction: &Transaction<'_>,
    minimum_age_milliseconds: i64,
) -> Result<bool, ExecutionSlotError> {
    if minimum_age_milliseconds <= 0 {
        return Err(ExecutionSlotError::InvalidState);
    }
    let cleared = transaction
        .execute(
            "UPDATE worker_execution_slots SET preempt_requested_by = NULL,\x20\
               preempt_requested_at = NULL, updated_at = clock_timestamp()\x20\
             WHERE slot_key = $1 AND owner IS NULL AND preempt_requested_by IS NOT NULL\x20\
               AND preempt_requested_at <=\x20\
                 clock_timestamp() - ($2::bigint * interval '1 millisecond')",
            &[&SLOT_KEY, &minimum_age_milliseconds],
        )
        .await?;
    Ok(cleared == 1)
}

pub(crate) async fn request_analysis_preemption(
    transaction: &Transaction<'_>,
    holder: &ExecutionSlotHolder,
    requested_by: &str,
) -> Result<bool, ExecutionSlotError> {
    if holder.task_kind != ExecutionTaskKind::Analysis || holder.expired || !holder.preemptible {
        return Ok(false);
    }
    let requested = transaction
        .execute(
            "UPDATE worker_execution_slots SET preempt_requested_by = $1,\x20\
               preempt_requested_at = clock_timestamp(), updated_at = clock_timestamp()\x20\
             WHERE slot_key = $2 AND task_kind = 'analysis' AND owner = $3 AND job_id = $4\x20\
               AND attempt_id = $5 AND fencing_token = $6 AND holder_preemptible = true\x20\
               AND lease_expires_at > clock_timestamp() AND preempt_requested_by IS NULL",
            &[
                &requested_by,
                &SLOT_KEY,
                &holder.owner,
                &holder.job_id,
                &holder.attempt_id,
                &holder.fencing_token,
            ],
        )
        .await?;
    Ok(requested == 1)
}

fn valid_runtime_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_kind_wire_vocabulary_is_closed() {
        assert_eq!(ExecutionTaskKind::Analysis.wire(), "analysis");
        assert_eq!(ExecutionTaskKind::Ocr.wire(), "ocr");
        assert_eq!(
            ExecutionTaskKind::parse("unknown")
                .err()
                .map(|error| error.kind()),
            Some("execution_slot_invalid_state")
        );
    }
}
