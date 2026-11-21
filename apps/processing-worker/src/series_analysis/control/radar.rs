//! Radar operations share the durable queue and process resource budget.

use tokio_postgres::Transaction;

use super::{ClaimedJob, ControlError};
use crate::series_analysis::artifact::ValidatedArtifact;
mod completion;
mod materialize;
pub(super) use completion::complete_preparation;
pub(super) use materialize::materialize_next;
pub(crate) use materialize::materialize_pending;

pub(super) enum PublicationState {
    Missing,
    Existing { has_active_operation: bool },
}

pub(super) async fn lock_matching_state(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
) -> Result<Option<PublicationState>, ControlError> {
    let row = tx.query_opt(
        "SELECT (SELECT legacy_id FROM series_radar_basis_identities WHERE id=desired_basis_id),
                generation, active_operation_id IS NOT NULL
         FROM series_radar_title_states
         WHERE game_title_id = (SELECT id FROM game_titles WHERE legacy_id=$1) FOR UPDATE",
        &[&claim.game_title_id],
    ).await?;
    let (basis, generation, state): (Option<String>, i64, _) = match row {
        Some(row) => (
            row.try_get(0)?,
            row.try_get(1)?,
            PublicationState::Existing {
                has_active_operation: row.try_get(2)?,
            },
        ),
        None => (None, 0, PublicationState::Missing),
    };
    Ok((basis == claim.radar_basis_id && generation == claim.radar_generation).then_some(state))
}

/// Roll back only the failed application generation; late failures cannot undo newer commands.
pub(super) async fn terminal_failure(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    code: &str,
) -> Result<(), ControlError> {
    terminal_failure_for_job(tx, &claim.job_id, code).await?;
    Ok(())
}

pub(crate) async fn terminal_failure_for_job(
    tx: &Transaction<'_>,
    job_id: &str,
    code: &str,
) -> Result<(), ControlError> {
    tx.execute("UPDATE series_radar_operations SET status='failed',safe_failure_code=$2,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE legacy_job_id=$1 AND status IN ('pending','running')", &[&job_id,&code]).await?;
    tx.execute("UPDATE series_radar_candidates c SET status='failed',safe_failure_code=$2,updated_at=clock_timestamp() FROM series_radar_operations o WHERE o.legacy_job_id=$1 AND o.candidate_id=c.id AND c.status='pending'", &[&job_id,&code]).await?;
    tx.execute("UPDATE series_radar_previews p SET status='failed',updated_at=clock_timestamp() FROM series_radar_operations o WHERE o.legacy_job_id=$1 AND o.preview_id=p.id AND p.status='pending'", &[&job_id]).await?;
    let rolled_back=tx.query_opt("UPDATE series_radar_title_states s SET desired_basis_id=current_basis_id,generation=s.generation+1,active_operation_id=NULL,updated_at=clock_timestamp() FROM series_analysis_jobs j WHERE j.legacy_id=$1 AND s.game_title_id=j.game_title_id AND s.generation=j.radar_generation AND EXISTS (SELECT 1 FROM series_radar_operations o WHERE o.id=s.active_operation_id AND o.job_id=j.id AND o.status='failed') RETURNING (SELECT legacy_id FROM game_titles WHERE id=s.game_title_id)", &[&job_id]).await?;
    if let Some(row) = rolled_back {
        let title: String = row.try_get(0)?;
        let request_id = super::transaction::stable_id("radar-recovery", &[job_id]);
        let canonical =
            crate::identity::allocate(crate::identity::Entity::AnalysisRequests, &request_id)
                .map_err(|_error| ControlError::InvalidMetadata)?;
        tx.execute("INSERT INTO series_analysis_job_requests (id,legacy_id,game_title_id,legacy_game_title_id,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,trigger,status) SELECT $3,$1,game_title_id,$2,input_revision,algorithm_version,artifact_schema_version,validation_contract_id,'manual','pending' FROM series_analysis_title_states WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$2) ON CONFLICT(legacy_id) DO NOTHING", &[&request_id,&title,&canonical]).await?;
        tx.execute("UPDATE series_analysis_title_states SET pending_work=true,updated_at=clock_timestamp() WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)", &[&title]).await?;
    }
    Ok(())
}

pub(super) async fn record_publication(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact: &ValidatedArtifact,
    state: PublicationState,
) -> Result<(), ControlError> {
    let artifact_id = &artifact.manifest().artifact_id;
    let check_application = match state {
        PublicationState::Existing {
            has_active_operation,
        } => has_active_operation,
        PublicationState::Missing => {
            // A newly initialized title has no operation. If another initializer won, keep
            // the generation and operation checks in the application SQL below.
            let inserted = tx
                .execute(
                    "INSERT INTO series_radar_title_states (game_title_id)
                 VALUES ((SELECT id FROM game_titles WHERE legacy_id=$1)) ON CONFLICT DO NOTHING",
                    &[&claim.game_title_id],
                )
                .await?;
            inserted == 0
        }
    };
    if check_application {
        finish_application(tx, claim, artifact_id).await?;
    }
    let updated = tx.execute(
        "UPDATE series_radar_title_states s
         SET previous_basis_id=CASE WHEN current_basis_id IS DISTINCT FROM b.id THEN current_basis_id ELSE previous_basis_id END,
             previous_applied_at=CASE WHEN current_basis_id IS DISTINCT FROM b.id THEN current_applied_at ELSE previous_applied_at END,
             current_basis_id=b.id, current_applied_at=a.radar_applied_at, active_operation_id=NULL,
             monitor=$5, updated_at=clock_timestamp()
         FROM series_analysis_artifacts a LEFT JOIN series_radar_basis_identities b ON b.legacy_id=$2
         WHERE s.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)
           AND s.generation=$3 AND a.id=$4",
        &[&claim.game_title_id, &claim.radar_basis_id, &claim.radar_generation,
          artifact_id, &artifact.radar_monitoring()],
    ).await?;
    super::publication::require_publication_row(updated)
}

async fn finish_application(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    artifact_id: &str,
) -> Result<(), ControlError> {
    // Application history is committed with the artifact pointer and immutable criteria. Normal
    // recalculation has no active application and cannot create another revision.
    tx.execute(
        "INSERT INTO series_radar_revisions (operation_id,game_title_id,candidate_id,before_basis_id,after_basis_id,change_kind,requested_by,requested_by_display_name,saved_by,saved_by_display_name,published_at) \
         SELECT o.legacy_id,o.legacy_game_title_id,c.legacy_id,(SELECT legacy_id FROM series_radar_basis_identities WHERE id=s.current_basis_id),$2,c.origin_kind,o.legacy_requested_by,o.requested_by_display_name,c.saved_by,c.saved_by_display_name,a.radar_applied_at \
         FROM series_radar_title_states s JOIN series_radar_operations o ON o.id=s.active_operation_id \
         JOIN series_radar_candidates c ON c.id=o.candidate_id AND c.game_title_id=s.game_title_id \
         JOIN series_analysis_artifacts a ON a.id=$4 AND a.game_title_id=$1 \
         WHERE s.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1) AND s.generation=$3 AND s.current_basis_id IS DISTINCT FROM (SELECT id FROM series_radar_basis_identities WHERE legacy_id=$2) \
           AND o.kind='apply' AND o.status IN ('pending','running') \
         ON CONFLICT(operation_id) DO NOTHING",
        &[&claim.game_title_id,&claim.radar_basis_id,&claim.radar_generation,&artifact_id],
    ).await?;
    tx.execute("UPDATE series_radar_candidates c SET status='applied',updated_at=clock_timestamp() FROM series_radar_operations o JOIN series_radar_title_states s ON s.active_operation_id=o.id WHERE c.id=o.candidate_id AND s.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1) AND s.generation=$2 AND o.kind='apply' AND o.status IN ('pending','running')", &[&claim.game_title_id,&claim.radar_generation]).await?;
    tx.execute("UPDATE series_radar_operations o SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp() FROM series_radar_title_states s WHERE s.active_operation_id=o.id AND s.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1) AND s.generation=$2 AND o.kind='apply' AND o.status IN ('pending','running')", &[&claim.game_title_id,&claim.radar_generation]).await?;
    Ok(())
}
