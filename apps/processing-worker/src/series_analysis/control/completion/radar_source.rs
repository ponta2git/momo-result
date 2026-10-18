//! Source facts are rechecked only while publishing an explicitly accepted basis application.

use momo_analysis_core::radar;
use tokio_postgres::Transaction;

use crate::series_analysis::{
    control::{ClaimedJob, ControlError},
    input_repository::{self, InputRepositoryError},
    radar_prepare,
};

/// The caller already owns the job lease, title revision and desired-generation locks.
/// Returning false keeps invalidation in the same commit as the existing terminal-failure rollback.
pub(super) async fn validate(
    transaction: &Transaction<'_>,
    claim: &ClaimedJob,
) -> Result<bool, ControlError> {
    let active = transaction
        .query_opt(
            "SELECT c.id,o.preview_id FROM series_radar_title_states s \
             JOIN series_radar_operations o ON o.id=s.active_operation_id \
             JOIN series_radar_candidates c ON c.id=o.candidate_id AND c.game_title_id=s.game_title_id \
             WHERE s.game_title_id=$1 AND s.generation=$2 \
               AND s.desired_basis_id IS NOT DISTINCT FROM $3 \
               AND s.current_basis_id IS DISTINCT FROM s.desired_basis_id \
               AND o.kind='apply' AND o.status IN ('pending','running')",
            &[&claim.game_title_id, &claim.radar_generation, &claim.radar_basis_id],
        )
        .await?;
    let Some(active) = active else {
        // Already applied criteria stay frozen even if one of their historic records is corrected.
        return Ok(true);
    };
    let candidate_id: String = active.try_get(0)?;
    let (basis, saved_source) = radar_prepare::load_basis(
        transaction,
        claim.radar_basis_id.as_deref(),
        &claim.game_title_id,
    )
    .await
    .map_err(saved_basis_error)?;
    let manual = basis.as_ref().is_some_and(|basis| basis.manual.is_some());
    let source = if manual {
        let preview_id: Option<String> = active.try_get(1)?;
        let row = transaction.query_opt(
            "SELECT evaluation_snapshot,input_checksum FROM series_radar_previews WHERE id=$1 AND candidate_id=$2 AND game_title_id=$3 AND octet_length(evaluation_snapshot::text)<=33554432",
            &[&preview_id,&candidate_id,&claim.game_title_id],
        ).await?.ok_or(ControlError::InvalidMetadata)?;
        let value: serde_json::Value = row.try_get(0)?;
        let source: radar::RadarSourceSnapshot =
            serde_json::from_value(value).map_err(|_invalid| ControlError::InvalidMetadata)?;
        source
            .normalized_for_validation(0)
            .map_err(|_invalid| ControlError::InvalidMetadata)?;
        if source.matches.is_empty()
            || source.game_title_id != claim.game_title_id
            || source
                .summary()
                .map_err(|_invalid| ControlError::InvalidMetadata)?
                .source_checksum
                != row.try_get::<_, String>(1)?
        {
            return Err(ControlError::InvalidMetadata);
        }
        source
    } else {
        saved_source.ok_or(ControlError::InvalidMetadata)?
    };
    let current = input_repository::load_in_transaction(
        transaction,
        &claim.game_title_id,
        claim.input_revision,
    )
    .await
    .map_err(current_input_error)?;
    let valid = radar::source_is_current(&source, &current)
        .map_err(|_invalid| ControlError::AuthoritativeInputContract)?;
    if !valid {
        let status = if manual { "ready" } else { "invalid" };
        let reason = if manual {
            "evaluation_changed"
        } else {
            "source_changed"
        };
        transaction.execute(
            "UPDATE series_radar_candidates SET status=$3,safe_failure_code=$4,updated_at=clock_timestamp() \
             WHERE id=$1 AND game_title_id=$2",
            &[&candidate_id, &claim.game_title_id,&status,&reason],
        ).await?;
        transaction
            .execute(
                "UPDATE series_radar_previews SET status='stale',updated_at=clock_timestamp() \
             WHERE candidate_id=$1 AND status IN ('pending','ready')",
                &[&candidate_id],
            )
            .await?;
    }
    Ok(valid)
}

fn saved_basis_error(error: InputRepositoryError) -> ControlError {
    match error {
        InputRepositoryError::Postgres(error) => ControlError::Postgres(error),
        InputRepositoryError::TitleNotFound
        | InputRepositoryError::Superseded
        | InputRepositoryError::InputContract(_) => ControlError::InvalidMetadata,
    }
}

fn current_input_error(error: InputRepositoryError) -> ControlError {
    match error {
        InputRepositoryError::Postgres(error) => ControlError::Postgres(error),
        InputRepositoryError::TitleNotFound
        | InputRepositoryError::Superseded
        | InputRepositoryError::InputContract(_) => ControlError::AuthoritativeInputContract,
    }
}
