use std::time::Instant;

use momo_analysis_core::radar::{self, RadarCandidate};
use tokio_postgres::{Client, Transaction};

use super::super::{self as control, ClaimedJob, ControlError};
use crate::series_analysis::{
    input_repository,
    radar_prepare::{self, Preparation, RadarReadContext},
};

pub(in crate::series_analysis::control) async fn complete_preparation(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &crate::series_analysis::config::AnalysisConsumerConfig,
    directory: &std::path::Path,
    metrics: &control::AttemptMetrics,
) -> Result<crate::worker::ControlOutcome<control::PublicationResult>, ControlError> {
    let started = Instant::now();
    let prepared = radar_prepare::read(
        directory,
        config.execution_limits.temporary_bytes_limit.get(),
    )?;
    if prepared.schema_version != 2
        || prepared.game_title_id != claim.game_title_id
        || prepared.input_revision != claim.input_revision
        || Some(prepared.operation_id.as_str()) != claim.radar_operation_id.as_deref()
    {
        return Err(ControlError::InvalidMetadata);
    }
    let context = validated_context(client, claim, &prepared).await?;
    let source_summary = prepared
        .evaluation_snapshot
        .summary()
        .map_err(|_error| ControlError::InvalidMetadata)?;
    let candidate_source = prepared
        .candidate
        .as_ref()
        .map(|candidate| &candidate.source)
        .or(context.source.as_ref())
        .or_else(|| context.is_manual().then_some(&prepared.evaluation_snapshot))
        .ok_or(ControlError::InvalidMetadata)?;
    loop {
        if started.elapsed() >= config.execution_limits.finalization_timeout {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "radar finalization input kept changing",
            )
            .into());
        }
        let current = input_repository::load_current_input(client, &claim.game_title_id)
            .await
            .map_err(|_error| ControlError::AuthoritativeInputContract)?;
        let current_summary = radar::snapshot(&current)
            .and_then(|value| value.summary())
            .map_err(|_error| ControlError::InvalidMetadata)?;
        let current_achievements = momo_analysis_core::achievements::calculate(
            current.game_title_id(),
            current.achievements(),
            current.player_matches(),
            momo_analysis_core::achievements::AchievementCurve::default(),
        );
        let achievements_current =
            prepared.evaluation_snapshot.achievements.as_deref() == Some(&current_achievements);
        if current.input_revision() == claim.input_revision
            && (current_summary != source_summary || !achievements_current)
        {
            return Err(ControlError::AuthoritativeInputContract);
        }
        let source_valid = context.is_manual()
            || radar::source_is_current(candidate_source, &current)
                .map_err(|_error| ControlError::InvalidMetadata)?;
        let tx = control::transaction::bounded_transaction(
            client,
            config.execution_limits.finalization_timeout,
        )
        .await?;
        control::transaction::lock_owned(&tx, claim, &config.worker_id).await?;
        let revision: i64 = tx
            .query_one(
                "SELECT input_revision FROM series_analysis_title_states WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)",
                &[&claim.game_title_id],
            )
            .await?
            .try_get(0)?;
        if revision != current.input_revision() {
            tx.rollback().await?;
            continue;
        }
        save_preparation(
            &tx,
            claim,
            &prepared,
            &context,
            source_valid,
            current_summary.source_checksum == source_summary.source_checksum
                && achievements_current,
        )
        .await?;
        control::transaction::finish_attempt(
            &tx,
            claim,
            control::AttemptOutcome::Succeeded,
            metrics,
        )
        .await?;
        tx.execute("UPDATE series_analysis_jobs SET status='succeeded',finished_at=clock_timestamp(),result_disposition='none',lease_owner=NULL,lease_attempt_id=NULL,legacy_lease_attempt_id=NULL,lease_fencing_token=NULL,lease_expires_at=NULL,lease_validation_contract_id=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1", &[&claim.job_id]).await?;
        let mut effects = control::TransactionEffects::empty();
        control::transaction::schedule_follow_up(&tx, claim, &mut effects).await?;

        effects.record_series_analysis();
        tx.commit().await?;
        return Ok(effects.committed(control::PublicationResult::Prepared));
    }
}

async fn validated_context(
    client: &mut Client,
    claim: &ClaimedJob,
    prepared: &Preparation,
) -> Result<RadarReadContext, ControlError> {
    let tx = client.build_transaction().read_only(true).start().await?;
    let context = radar_prepare::load_context(&tx, &claim.job_id, &claim.game_title_id)
        .await
        .map_err(|_invalid| ControlError::InvalidMetadata)?;
    // The currently applied basis may have changed; validate the saved comparison's immutable
    // before-basis, then mark freshness against the new current basis under the title lock.
    let (before_basis, _) = radar_prepare::load_basis(
        &tx,
        prepared.before_basis_id.as_deref(),
        &claim.game_title_id,
    )
    .await
    .map_err(|_invalid| ControlError::InvalidMetadata)?;
    radar_prepare::validate(prepared, &context, before_basis.as_ref())
        .map_err(|_invalid| ControlError::InvalidMetadata)?;
    tx.commit().await?;
    Ok(context)
}

async fn save_preparation(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    prepared: &Preparation,
    context: &RadarReadContext,
    source_valid: bool,
    evaluation_current: bool,
) -> Result<(), ControlError> {
    let operation = tx.query_opt("SELECT o.status,c.status FROM series_radar_operations o JOIN series_radar_candidates c ON c.id=o.candidate_id WHERE o.legacy_id=$1 AND o.legacy_job_id=$2 AND c.legacy_id=$3 FOR UPDATE OF o,c", &[&prepared.operation_id,&claim.job_id,&prepared.candidate_id]).await?.ok_or(ControlError::InvalidMetadata)?;
    let operation_status: String = operation.try_get(0)?;
    let candidate_status: String = operation.try_get(1)?;
    if operation_status == "withdrawn" || candidate_status == "withdrawn" {
        return Ok(());
    }
    if !matches!(operation_status.as_str(), "pending" | "running") {
        return Err(ControlError::InvalidMetadata);
    }
    let valid = source_valid && candidate_status != "invalid";
    if let Some(candidate) = &prepared.candidate {
        save_candidate(tx, claim, prepared, candidate, valid).await?;
    } else if context.manual.is_some() && valid {
        save_manual_candidate(tx, claim, prepared, context).await?;
    } else if !valid {
        tx.execute("UPDATE series_radar_candidates SET status='invalid',safe_failure_code='source_changed',updated_at=clock_timestamp() WHERE legacy_id=$1", &[&prepared.candidate_id]).await?;
    } else if context.operation_kind.as_deref() == Some("restore") {
        let basis = context
            .basis
            .as_ref()
            .ok_or(ControlError::InvalidMetadata)?;
        let result = basis
            .candidate_summary()
            .map_err(|_invalid| ControlError::InvalidMetadata)?;
        tx.execute("UPDATE series_radar_candidates c SET status='ready',result=$2,source_input_revision=b.source_input_revision,safe_failure_code=NULL,updated_at=clock_timestamp() FROM series_radar_bases b WHERE c.legacy_id=$1 AND c.basis_id=(SELECT id FROM series_radar_basis_identities WHERE legacy_id=b.id) AND b.id=$3", &[&prepared.candidate_id,&json(&result)?,&context.basis_id]).await?;
    } else if context.operation_kind.as_deref() == Some("preview") {
        tx.execute(
            "UPDATE series_radar_candidates SET safe_failure_code=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1",
            &[&prepared.candidate_id],
        ).await?;
    }
    let current_basis: Option<String> = tx
        .query_opt(
            "SELECT (SELECT legacy_id FROM series_radar_basis_identities WHERE id=current_basis_id) FROM series_radar_title_states WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)",
            &[&claim.game_title_id],
        )
        .await?
        .map(|row| row.try_get(0))
        .transpose()?
        .flatten();
    let fresh = valid
        && evaluation_current
        && current_basis == prepared.before_basis_id
        && (!context.is_manual() || !prepared.evaluation_snapshot.matches.is_empty());
    let preview_id = save_preview(tx, prepared, fresh).await?;
    tx.execute("UPDATE series_radar_operations SET status='succeeded',preview_id=(SELECT id FROM series_radar_previews WHERE legacy_id=$2),finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE legacy_id=$1 AND status IN ('pending','running')", &[&prepared.operation_id,&preview_id]).await?;
    Ok(())
}

async fn save_manual_candidate(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    prepared: &Preparation,
    context: &RadarReadContext,
) -> Result<(), ControlError> {
    if let Some(basis) = &prepared.manual_basis {
        let checksum = basis
            .checksum()
            .map_err(|_invalid| ControlError::InvalidMetadata)?;
        let source_checksum = &basis.monitoring_source().source_checksum;
        let inserted = tx.execute(
            "INSERT INTO series_radar_bases (id,game_title_id,checksum,payload,source_snapshot,source_checksum,source_input_revision) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
            &[&prepared.candidate_id,&claim.game_title_id,&checksum,&json(basis)?,&json(&prepared.evaluation_snapshot)?,&source_checksum,&prepared.input_revision],
        ).await?;
        let saved = tx.query_one(
            "SELECT checksum,source_checksum FROM series_radar_bases WHERE id=$1 AND game_title_id=$2",
            &[&prepared.candidate_id,&claim.game_title_id],
        ).await?;
        if saved.try_get::<_, String>(0)? != checksum
            || saved.try_get::<_, String>(1)? != *source_checksum
        {
            return Err(ControlError::InvalidMetadata);
        }
        save_basis_identity(tx, &prepared.candidate_id, &claim.game_title_id, inserted).await?;
        let result = basis
            .candidate_summary()
            .map_err(|_invalid| ControlError::InvalidMetadata)?;
        tx.execute(
            "UPDATE series_radar_candidates SET basis_id=(SELECT id FROM series_radar_basis_identities WHERE legacy_id=$2),status='ready',result=$3,source_input_revision=$4,safe_failure_code=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1 AND basis_id IS NULL",
            &[&prepared.candidate_id,&prepared.candidate_id,&json(&result)?,&prepared.input_revision],
        ).await?;
    } else if prepared.evaluation_snapshot.matches.is_empty() {
        // The shared input survives a zero-record comparison. No basis or monitoring start is
        // invented; a later preview can complete the same candidate after records are added.
        tx.execute(
            "UPDATE series_radar_candidates SET status='unavailable',safe_failure_code='no_matches',updated_at=clock_timestamp() WHERE legacy_id=$1",
            &[&prepared.candidate_id],
        ).await?;
    } else if context.basis.is_some() {
        tx.execute(
            "UPDATE series_radar_candidates SET status='ready',safe_failure_code=NULL,updated_at=clock_timestamp() WHERE legacy_id=$1",
            &[&prepared.candidate_id],
        ).await?;
    } else {
        return Err(ControlError::InvalidMetadata);
    }
    Ok(())
}

async fn save_candidate(
    tx: &Transaction<'_>,
    claim: &ClaimedJob,
    prepared: &Preparation,
    candidate: &RadarCandidate,
    valid: bool,
) -> Result<(), ControlError> {
    let basis_id = if let Some(basis) = &candidate.basis {
        let checksum = basis
            .checksum()
            .map_err(|_invalid| ControlError::InvalidMetadata)?;
        let payload = json(basis)?;
        let source = json(&candidate.source)?;
        let inserted = tx.execute("INSERT INTO series_radar_bases (id,game_title_id,checksum,payload,source_snapshot,source_checksum,source_input_revision) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING", &[&prepared.candidate_id,&claim.game_title_id,&checksum,&payload,&source,&candidate.source_summary.source_checksum,&claim.input_revision]).await?;
        let saved = tx
            .query_one(
                "SELECT checksum,source_checksum FROM series_radar_bases WHERE id=$1",
                &[&prepared.candidate_id],
            )
            .await?;
        if saved.try_get::<_, String>(0)? != checksum
            || saved.try_get::<_, String>(1)? != candidate.source_summary.source_checksum
        {
            return Err(ControlError::InvalidMetadata);
        }
        save_basis_identity(tx, &prepared.candidate_id, &claim.game_title_id, inserted).await?;
        Some(prepared.candidate_id.as_str())
    } else {
        None
    };
    let status = if !valid {
        "invalid"
    } else if basis_id.is_some() {
        "ready"
    } else {
        "unavailable"
    };
    let failure_code = (!valid).then_some("source_changed");
    tx.execute("UPDATE series_radar_candidates SET basis_id=(SELECT id FROM series_radar_basis_identities WHERE legacy_id=$2),status=$3,result=$4,source_input_revision=$5,safe_failure_code=$6,updated_at=clock_timestamp() WHERE legacy_id=$1", &[&prepared.candidate_id,&basis_id,&status,&json(&candidate.summary())?,&claim.input_revision,&failure_code]).await?;
    Ok(())
}

async fn save_preview(
    tx: &Transaction<'_>,
    prepared: &Preparation,
    fresh: bool,
) -> Result<String, ControlError> {
    let source_summary = prepared
        .evaluation_snapshot
        .summary()
        .map_err(|_invalid| ControlError::InvalidMetadata)?;
    let preview_id = prepared.preview_id.clone().unwrap_or_else(|| {
        control::transaction::stable_id("radar-preview", &[&prepared.operation_id])
    });
    let keys = prepared
        .scopes
        .iter()
        .map(|value| value.scope.key())
        .collect::<Vec<_>>();
    let state = if fresh { "ready" } else { "stale" };
    let canonical = if let Some(existing) = tx.query_opt(
        "SELECT id FROM series_radar_previews WHERE legacy_id=$1 AND game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$2)",
        &[&preview_id, &prepared.game_title_id],
    ).await? {
        existing.try_get::<_, uuid::Uuid>(0)?
    } else if prepared.preview_id.is_none() {
        crate::identity::allocate(crate::identity::Entity::RadarPreviews, &preview_id)
            .map_err(|_error| ControlError::InvalidMetadata)?
    } else {
        return Err(ControlError::InvalidMetadata);
    };
    tx.execute("INSERT INTO series_radar_previews (id,legacy_id,game_title_id,candidate_id,before_basis_id,input_revision,status,input_checksum,evaluation_snapshot,scope_keys) VALUES ($10,$1,(SELECT id FROM game_titles WHERE legacy_id=$2),(SELECT id FROM series_radar_candidates WHERE legacy_id=$3),(SELECT id FROM series_radar_basis_identities WHERE legacy_id=$4),$5,$6,$7,$8,$9) ON CONFLICT(legacy_id) DO UPDATE SET before_basis_id=EXCLUDED.before_basis_id,input_revision=EXCLUDED.input_revision,status=EXCLUDED.status,input_checksum=EXCLUDED.input_checksum,evaluation_snapshot=EXCLUDED.evaluation_snapshot,scope_keys=EXCLUDED.scope_keys,updated_at=clock_timestamp()", &[&preview_id,&prepared.game_title_id,&prepared.candidate_id,&prepared.before_basis_id,&prepared.input_revision,&state,&source_summary.source_checksum,&json(&prepared.evaluation_snapshot)?,&keys,&canonical]).await?;
    tx.execute(
        "DELETE FROM series_radar_preview_scopes WHERE preview_id=(SELECT id FROM series_radar_previews WHERE legacy_id=$1)",
        &[&preview_id],
    )
    .await?;
    for scope in &prepared.scopes {
        tx.execute("INSERT INTO series_radar_preview_scopes (preview_id,scope_key,payload) VALUES ((SELECT id FROM series_radar_previews WHERE legacy_id=$1),$2,$3)", &[&preview_id,&scope.scope.key(),&json(&scope.payload)?]).await?;
    }
    Ok(preview_id)
}

async fn save_basis_identity(
    tx: &Transaction<'_>,
    basis_id: &str,
    title_id: &str,
    inserted: u64,
) -> Result<(), ControlError> {
    if inserted == 1 {
        let canonical = crate::identity::allocate(crate::identity::Entity::RadarBases, basis_id)
            .map_err(|_error| ControlError::InvalidMetadata)?;
        tx.execute(
            "INSERT INTO series_radar_basis_identities (id,legacy_id,game_title_id,legacy_game_title_id) \
             VALUES ($1,$2,(SELECT id FROM game_titles WHERE legacy_id=$3),$3)",
            &[&canonical, &basis_id, &title_id],
        ).await?;
    } else if inserted != 0 || tx.query_opt(
        "SELECT id FROM series_radar_basis_identities WHERE legacy_id=$1 AND legacy_game_title_id=$2",
        &[&basis_id, &title_id],
    ).await?.is_none() {
        return Err(ControlError::InvalidMetadata);
    }
    Ok(())
}

fn json(value: &impl serde::Serialize) -> Result<serde_json::Value, ControlError> {
    let encoded = serde_json::to_vec(value).map_err(|_invalid| ControlError::InvalidMetadata)?;
    if encoded.len() > 32 * 1024 * 1024 {
        return Err(ControlError::InvalidMetadata);
    }
    serde_json::from_slice(&encoded).map_err(|_invalid| ControlError::InvalidMetadata)
}
