//! The frozen workflow may initialize one full campaign after reviewing an exact plan.
//! The workflow authenticates the live permit and consumer readiness. These inputs bind
//! that authorization to the local plan; a digest by itself is not an approval proof.
use serde_json::{Value, json};
use tokio_postgres::Transaction;

use super::{
    ALGORITHM_VERSION, ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID, PromotionIdentity,
    PromotionRequest, PromotionTrigger, TargetRow, apply_promotion, begin_promotion_transaction,
    canonical, existing_operation, lock_targets,
};
use crate::maintenance::{
    Mode,
    analysis::{
        Arguments, Phase, Report, Request, ScopeError, frozen_process, scope, valid_request,
    },
};

const DOMAIN: &str = "momo-maintenance-analysis-initialize-v1";
const PERMITTED_CHANGES: &[&str] = &[
    "release_tuple",
    "unsupported_reader_pointers",
    "title_desired_tuple_and_pending_work",
    "new_operation_campaign_and_all_targets",
];

#[derive(Clone)]
struct Authorization<'a> {
    candidate_release: &'a str,
    readiness_digest: &'a str,
}

pub(crate) async fn initialize(arguments: &Arguments) -> Result<Report, ScopeError> {
    let request = Request {
        cutover_id: arguments.cutover_id.clone(),
        stop_epoch: arguments.stop_epoch,
        operation_id: arguments.operation_id.clone(),
        campaign_id: arguments.campaign_id.clone(),
    };
    let authorization = authorization(arguments, &request)?;
    if Mode::from_environment().ok() != Some(Mode::Frozen)
        || std::env::var("MOMO_ANALYSIS_CONFIG_VERSION")
            .ok()
            .as_deref()
            != Some(format!("series-analysis-v1-{}", authorization.candidate_release).as_str())
    {
        return Err(ScopeError::Configuration);
    }
    let process_id = frozen_process(&request).await?;
    let database_url = std::env::var("DATABASE_URL").map_err(|_error| ScopeError::Configuration)?;
    let mut client = crate::postgres::connect(&database_url).await?;
    let locked: bool = client
        .query_one("SELECT pg_try_advisory_lock(1297042767, 1095649612)", &[])
        .await?
        .try_get(0)?;
    if !locked {
        return Err(ScopeError::Busy);
    }
    let transaction = begin_promotion_transaction(&mut client).await?;
    // Freeze the complete target set and every admission path before inspecting it.
    // The ordinary release transaction retains its capability-registry locks too.
    transaction.batch_execute(
        "LOCK TABLE game_titles, matches, series_analysis_title_states, series_radar_title_states, \
         series_analysis_operation_requests, series_analysis_campaigns, series_analysis_campaign_targets, \
         series_analysis_job_requests, series_analysis_jobs, series_radar_operations, ocr_jobs \
         IN SHARE ROW EXCLUSIVE MODE"
    ).await?;
    let report = initialize_transaction(
        &transaction,
        &request,
        &authorization,
        arguments.apply,
        arguments.expected_plan.as_deref(),
    )
    .await?;
    if frozen_process(&request).await? != process_id {
        return Err(ScopeError::Barrier);
    }
    if arguments.apply {
        transaction.commit().await?;
    } else {
        transaction.rollback().await?;
    }
    Ok(report)
}

fn authorization<'a>(
    arguments: &'a Arguments,
    request: &Request,
) -> Result<Authorization<'a>, ScopeError> {
    let candidate_release = arguments
        .candidate_release
        .as_deref()
        .ok_or(ScopeError::InvalidRequest)?;
    let readiness_digest = arguments
        .readiness_digest
        .as_deref()
        .ok_or(ScopeError::InvalidRequest)?;
    if arguments.phase != Phase::Initialize
        || !valid_request(request)
        || !lower_hex(candidate_release, 40)
        || !valid_digest(readiness_digest)
        || arguments
            .expected_plan
            .as_deref()
            .is_some_and(|value| !valid_digest(value))
        || (arguments.apply && arguments.expected_plan.is_none())
    {
        return Err(ScopeError::InvalidRequest);
    }
    Ok(Authorization {
        candidate_release,
        readiness_digest,
    })
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| lower_hex(hex, 64))
}

async fn initialize_transaction(
    transaction: &Transaction<'_>,
    request: &Request,
    authorization: &Authorization<'_>,
    apply: bool,
    expected_plan: Option<&str>,
) -> Result<Report, ScopeError> {
    if let Some(existing) = existing_operation(transaction, &request.operation_id).await? {
        let plan = expected_plan.ok_or(ScopeError::Plan)?;
        let targets = created_targets(transaction, request).await?;
        let continuation = scope::inspect_in(transaction, request).await?;
        if existing.campaign_id != request.campaign_id
            || existing.endpoint != format!("maintenance:initialize:{}", existing.trigger)
            || existing.key_hash != replay_binding(request, authorization, plan, &targets)
            || continuation.status == "attention_required"
            || !complete_target_set(transaction, request).await?
        {
            return Err(ScopeError::Scope);
        }
        return Ok(report(
            request,
            authorization,
            plan.to_owned(),
            Some(&continuation),
        ));
    }
    // A lone operation/campaign or an existing identifier is not an idempotent replay.
    let collision: bool = transaction
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM series_analysis_operation_requests WHERE legacy_id=$1) \
         OR EXISTS(SELECT 1 FROM series_analysis_campaigns WHERE legacy_id=$2)",
            &[&request.operation_id, &request.campaign_id],
        )
        .await?
        .try_get(0)?;
    if collision || !quiescent(transaction).await? {
        return Err(ScopeError::Scope);
    }
    let current: Value = transaction.query_one(
        "SELECT to_jsonb(r) FROM series_analysis_release_state r WHERE singleton_key='current' FOR UPDATE", &[]
    ).await?.try_get(0)?;
    let trigger = changed_trigger(&current);
    let mut titles = lock_targets(transaction, trigger).await?;
    // A frozen full campaign includes empty titles as well as record-bearing titles.
    for title in &mut titles {
        title.eligible = true;
    }
    let snapshots = transaction.query(
        "SELECT jsonb_build_array(title.legacy_id,to_jsonb(s),to_jsonb(radar)) \
         FROM series_analysis_title_states s JOIN game_titles title ON title.id=s.game_title_id \
         LEFT JOIN series_radar_title_states radar ON radar.game_title_id=s.game_title_id ORDER BY title.legacy_id", &[]
    ).await?.into_iter().map(|row| row.try_get::<_, Value>(0)).collect::<Result<Vec<_>, _>>()?;
    let plan = plan_digest(request, authorization, &current, &snapshots, trigger);
    if expected_plan.is_some_and(|expected| expected != plan) {
        return Err(ScopeError::Plan);
    }
    let mut planned = report(request, authorization, plan.clone(), None);
    planned.target_count = u64::try_from(titles.len()).map_err(|_error| ScopeError::Scope)?;
    if !apply {
        return Ok(planned);
    }
    let target_bindings = target_bindings(&titles);
    let key_hash = replay_binding(request, authorization, &plan, &target_bindings);
    apply_promotion(
        transaction,
        &PromotionRequest {
            trigger,
            operation_key: &plan,
            apply: true,
        },
        &titles,
        &PromotionIdentity {
            operation_id: &request.operation_id,
            campaign_id: &request.campaign_id,
            endpoint: &format!("maintenance:initialize:{}", trigger.wire()),
            key_hash: &key_hash,
        },
    )
    .await?;
    if created_targets(transaction, request).await? != target_bindings
        || !complete_target_set(transaction, request).await?
    {
        return Err(ScopeError::Scope);
    }
    let continuation = scope::inspect_in(transaction, request).await?;
    if continuation.status == "attention_required" {
        return Err(ScopeError::Plan);
    }
    Ok(report(request, authorization, plan, Some(&continuation)))
}

fn changed_trigger(current: &Value) -> PromotionTrigger {
    if current["validation_contract_id"] != ARTIFACT_VALIDATION_CONTRACT_ID {
        PromotionTrigger::ValidationContractUpdate
    } else if current["artifact_schema_version"] != ARTIFACT_SCHEMA_VERSION {
        PromotionTrigger::ArtifactSchemaUpdate
    } else if current["algorithm_version"] != ALGORITHM_VERSION {
        PromotionTrigger::AlgorithmUpdate
    } else {
        PromotionTrigger::InitialBackfill
    }
}

fn plan_digest(
    request: &Request,
    authorization: &Authorization<'_>,
    current: &Value,
    targets: &[Value],
    trigger: PromotionTrigger,
) -> String {
    canonical::sha256_prefixed(json!({
        "domain": DOMAIN, "schemaVersion": 2, "kind": "initialize", "request": request,
        "candidateRelease": authorization.candidate_release, "readinessDigest": authorization.readiness_digest,
        "current": current, "target": [ALGORITHM_VERSION, ARTIFACT_SCHEMA_VERSION, ARTIFACT_VALIDATION_CONTRACT_ID],
        "trigger": trigger, "targets": targets, "permittedChanges": PERMITTED_CHANGES,
    }).to_string().as_bytes())
}

fn target_bindings(titles: &[TargetRow]) -> Vec<Value> {
    titles
        .iter()
        .map(|title| {
            json!([
                title.game_title_id,
                title.input_revision,
                ALGORITHM_VERSION,
                ARTIFACT_SCHEMA_VERSION,
                ARTIFACT_VALIDATION_CONTRACT_ID
            ])
        })
        .collect()
}

fn replay_binding(
    request: &Request,
    authorization: &Authorization<'_>,
    plan: &str,
    targets: &[Value],
) -> String {
    canonical::sha256_prefixed(
        json!([
            "momo-maintenance-analysis-initialized-v1",
            request,
            authorization.candidate_release,
            authorization.readiness_digest,
            plan,
            targets,
        ])
        .to_string()
        .as_bytes(),
    )
}

async fn created_targets(
    transaction: &Transaction<'_>,
    request: &Request,
) -> Result<Vec<Value>, ScopeError> {
    Ok(transaction.query(
        "SELECT jsonb_build_array(t.legacy_game_title_id,t.input_revision,t.algorithm_version,t.artifact_schema_version,t.validation_contract_id) \
         FROM series_analysis_campaign_targets t JOIN series_analysis_campaigns c ON c.id=t.campaign_id \
         WHERE c.legacy_id=$1 ORDER BY t.legacy_game_title_id", &[&request.campaign_id]
    ).await?.into_iter().map(|row| row.try_get::<_, Value>(0)).collect::<Result<Vec<_>, _>>()?)
}

async fn complete_target_set(
    transaction: &Transaction<'_>,
    request: &Request,
) -> Result<bool, ScopeError> {
    Ok(transaction.query_one(
        "SELECT NOT EXISTS ( \
           SELECT 1 FROM series_analysis_title_states s FULL JOIN ( \
             SELECT t.* FROM series_analysis_campaign_targets t JOIN series_analysis_campaigns c ON c.id=t.campaign_id WHERE c.legacy_id=$1 \
           ) t ON t.game_title_id=s.game_title_id \
           WHERE s.game_title_id IS NULL OR t.game_title_id IS NULL OR s.input_revision<>t.input_revision \
             OR s.algorithm_version<>t.algorithm_version OR s.artifact_schema_version<>t.artifact_schema_version \
             OR s.validation_contract_id IS DISTINCT FROM t.validation_contract_id \
         ) AND NOT EXISTS (SELECT 1 FROM game_titles title LEFT JOIN series_analysis_title_states s ON s.game_title_id=title.id WHERE s.game_title_id IS NULL)",
        &[&request.campaign_id]
    ).await?.try_get(0)?)
}

async fn quiescent(transaction: &Transaction<'_>) -> Result<bool, ScopeError> {
    Ok(transaction.query_one(
        "SELECT NOT EXISTS (SELECT 1 FROM series_analysis_jobs WHERE status IN ('queued','running')) \
         AND NOT EXISTS (SELECT 1 FROM series_analysis_job_requests WHERE status<>'fulfilled') \
         AND NOT EXISTS (SELECT 1 FROM series_analysis_campaigns WHERE status<>'terminal') \
         AND NOT EXISTS (SELECT 1 FROM series_analysis_operation_requests WHERE status<>'terminal') \
         AND NOT EXISTS (SELECT 1 FROM series_radar_operations WHERE status IN ('pending','running')) \
         AND NOT EXISTS (SELECT 1 FROM ocr_jobs WHERE status IN ('queued','running')) \
         AND NOT EXISTS (SELECT 1 FROM series_analysis_title_states WHERE pending_work) \
         AND NOT EXISTS (SELECT 1 FROM game_titles title LEFT JOIN series_analysis_title_states s ON s.game_title_id=title.id WHERE s.game_title_id IS NULL)", &[]
    ).await?.try_get(0)?)
}

fn report(
    request: &Request,
    authorization: &Authorization<'_>,
    plan_digest: String,
    continuation: Option<&Report>,
) -> Report {
    Report {
        schema_version: 2,
        kind: "initialize",
        request: request.clone(),
        plan_digest,
        status: if continuation.is_some() {
            "initialized"
        } else {
            "planned"
        },
        target_count: continuation.map_or(0, |value| value.target_count),
        completed_count: continuation.map_or(0, |value| value.completed_count),
        failed_count: continuation.map_or(0, |value| value.failed_count),
        candidate_release: Some(authorization.candidate_release.to_owned()),
        readiness_digest: Some(authorization.readiness_digest.to_owned()),
        continuation_plan_digest: continuation.map(|value| value.plan_digest.clone()),
        next_pending_title: None,
        next_job: None,
    }
}

#[cfg(test)]
mod tests;
