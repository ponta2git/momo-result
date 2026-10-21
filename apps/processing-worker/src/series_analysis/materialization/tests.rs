use std::error::Error;
use tokio_postgres::Client;
type SmokeResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
const CAMPAIGN_ID: &str = "analysis-campaign-smoke";
const CAMPAIGN_OPERATION_ID: &str = "analysis-campaign-smoke-operation";
use super::*;
use std::time::{Duration, SystemTime};

#[test]
fn campaign_ids_match_the_cross_runtime_sha256_contract() {
    let target = campaign_target(SystemTime::UNIX_EPOCH);

    assert_eq!(
        campaign_stable_id("analysis-request", &target),
        "analysis-request-356b33cedb6a6d732ae4f53968121356"
    );
    assert_eq!(
        campaign_stable_id("analysis-job", &target),
        "analysis-job-9321a6c13f14001a5bd49b2d9b381e03"
    );
}

#[test]
fn campaign_assignment_decision_preserves_the_acceptance_race_boundary() {
    let accepted_at = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
    let target = campaign_target(accepted_at);
    let queued = active_job("queued", None, None);
    let running_before = active_job(
        "running",
        Some(accepted_at - Duration::from_secs(1)),
        Some("attempt-before"),
    );
    let running_at_acceptance =
        active_job("running", Some(accepted_at), Some("attempt-at-acceptance"));
    let running_after = active_job(
        "running",
        Some(accepted_at + Duration::from_secs(1)),
        Some("attempt-after"),
    );
    let running_without_attempt = active_job("running", Some(accepted_at), None);

    assert_eq!(
        campaign_assignment_decision(None, &target).ok(),
        Some(CampaignAssignmentDecision::Create)
    );
    assert_eq!(
        campaign_assignment_decision(Some(&queued), &target).ok(),
        Some(CampaignAssignmentDecision::RefreshQueued {
            job_id: "active-job"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_before), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_at_acceptance), &target).ok(),
        Some(CampaignAssignmentDecision::JoinRunning {
            job_id: "active-job",
            attempt_id: "attempt-at-acceptance"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_after), &target).ok(),
        Some(CampaignAssignmentDecision::JoinRunning {
            job_id: "active-job",
            attempt_id: "attempt-after"
        })
    );
    assert_eq!(
        campaign_assignment_decision(Some(&running_without_attempt), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
}

#[test]
fn campaign_never_joins_a_running_attempt_under_a_different_version_contract() {
    let accepted_at = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
    let target = campaign_target(accepted_at);
    let mut running = active_job("running", Some(accepted_at), Some("attempt-1"));

    running.validation_contract_id = Some(String::from("different-validation-contract"));
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    running.validation_contract_id = target.validation_contract_id.clone();
    running.algorithm_version = String::from("different-algorithm");
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
    running
        .algorithm_version
        .clone_from(&target.algorithm_version);
    running.artifact_schema_version = target.artifact_schema_version + 1;
    assert_eq!(
        campaign_assignment_decision(Some(&running), &target).ok(),
        Some(CampaignAssignmentDecision::DeferForcedRun)
    );
}

#[test]
fn only_release_campaigns_require_one_uniform_version_tuple() {
    assert_eq!(
        campaign_requires_uniform_version("manual").ok(),
        Some(false)
    );
    for trigger in [
        "algorithm_update",
        "artifact_schema_update",
        "validation_contract_update",
        "initial_backfill",
    ] {
        assert_eq!(campaign_requires_uniform_version(trigger).ok(), Some(true));
    }
    assert!(campaign_requires_uniform_version("unknown-trigger").is_err());
}

fn campaign_target(accepted_at: SystemTime) -> CampaignTarget {
    CampaignTarget {
        campaign_id: String::from("campaign-1"),
        game_title_id: String::from("title-1"),
        input_revision: 3,
        algorithm_version: String::from("series-analysis-v1"),
        artifact_schema_version: 1,
        validation_contract_id: None,
        accepted_at,
        operation_id: String::from("operation-1"),
        trigger: String::from("manual"),
    }
}

fn active_job(
    status: &str,
    started_at: Option<SystemTime>,
    attempt_id: Option<&str>,
) -> ActiveAnalysisJob {
    ActiveAnalysisJob {
        work_kind: String::from("analysis"),
        id: String::from("active-job"),
        status: String::from(status),
        algorithm_version: String::from("series-analysis-v1"),
        artifact_schema_version: 1,
        validation_contract_id: None,
        started_at,
        attempt_id: attempt_id.map(String::from),
    }
}

#[expect(
    clippy::too_many_lines,
    clippy::panic_in_result_fn,
    reason = "one isolated integration scenario keeps the campaign decision table and projections visible"
)]
#[tokio::test]
#[ignore = "requires explicitly isolated PROCESSING_SCHEDULER_SMOKE_DATABASE_URL"]
async fn real_postgres_preserves_campaign_acceptance_and_assignment() -> SmokeResult {
    let database_url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
    let mut database = crate::identity::fixtures::connect(&database_url).await?;
    cleanup_campaign_expansion_fixture(&database).await?;
    database
        .batch_execute(
            r"
WITH fixture_titles AS (
       INSERT INTO game_titles (id, legacy_id, name, layout_family, display_order)
       VALUES (pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-new'), 'analysis-campaign-smoke-new',
               'campaign new', 'momotetsu_2', 9901), (pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-queued'),
               'analysis-campaign-smoke-queued', 'campaign queued', 'momotetsu_2', 9902),
              (pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-before'), 'analysis-campaign-smoke-before',
               'campaign before', 'momotetsu_2', 9903), (pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-after'),
               'analysis-campaign-smoke-after', 'campaign after', 'momotetsu_2', 9904),
              (pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-deleted'), 'analysis-campaign-smoke-deleted',
               'campaign deleted', 'momotetsu_2', 9905)
       RETURNING id
     )
  INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
  SELECT fixture_titles.id, release.algorithm_version, release.artifact_schema_version, release.validation_contract_id
  FROM fixture_titles CROSS JOIN series_analysis_release_state AS release
  WHERE release.singleton_key = 'current'
  ON CONFLICT (game_title_id) DO NOTHING;
INSERT INTO series_analysis_title_states (game_title_id, algorithm_version, artifact_schema_version, validation_contract_id)
SELECT pg_temp.fixture_uuid('game_titles', t.legacy_id), r.algorithm_version, r.artifact_schema_version, r.validation_contract_id
FROM game_titles AS t CROSS JOIN series_analysis_release_state AS r
WHERE t.legacy_id LIKE 'analysis-campaign-smoke-%' AND r.singleton_key = 'current'
ON CONFLICT DO NOTHING;
INSERT INTO series_radar_title_states (game_title_id, generation)
SELECT series_analysis_title_states.game_title_id, 7
FROM series_analysis_title_states
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) LIKE 'analysis-campaign-smoke-%';
UPDATE series_analysis_title_states
SET algorithm_version = 'series-analysis-v5', artifact_schema_version = 4,
    validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1'
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) LIKE 'analysis-campaign-smoke-%';
UPDATE series_analysis_title_states
SET input_revision = 9, algorithm_version = 'series-analysis-v2', artifact_schema_version = 4
WHERE (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = 'analysis-campaign-smoke-queued';
INSERT INTO series_analysis_operation_requests (id, legacy_id, scope, game_title_id, legacy_game_title_id,
                                                requested_by_account_id, idempotency_key_hash, endpoint, status, target_count, accepted_at)
VALUES (pg_temp.fixture_uuid('series_analysis_operation_requests', 'analysis-campaign-smoke-operation'),
        'analysis-campaign-smoke-operation', 'all_titles', NULL, NULL, NULL, 'analysis-campaign-smoke-idempotency',
        '/series-analysis/recalculate-all', 'pending', 5, clock_timestamp() - CAST('1 minute' AS interval));
INSERT INTO series_analysis_campaigns (id, legacy_id, operation_request_id, trigger, algorithm_version,
                                       artifact_schema_version, validation_contract_id, status, target_count, accepted_at)
SELECT pg_temp.fixture_uuid('series_analysis_campaigns', 'analysis-campaign-smoke'), 'analysis-campaign-smoke',
       pg_temp.fixture_uuid('series_analysis_operation_requests', series_analysis_operation_requests.legacy_id), 'manual',
       'mixed', 4, NULL, 'expanding', 5, accepted_at
FROM series_analysis_operation_requests
WHERE series_analysis_operation_requests.legacy_id = 'analysis-campaign-smoke-operation';
INSERT INTO series_analysis_campaign_targets (campaign_id, game_title_id, legacy_game_title_id, input_revision,
                                              algorithm_version, artifact_schema_version, validation_contract_id, accepted_at)
SELECT pg_temp.fixture_uuid('series_analysis_campaigns', c.legacy_id), s.game_title_id,
       (SELECT fixture_parent.legacy_id
        FROM game_titles AS fixture_parent
        WHERE fixture_parent.id = s.game_title_id), s.input_revision, s.algorithm_version, s.artifact_schema_version,
       s.validation_contract_id, c.accepted_at
FROM series_analysis_campaigns AS c CROSS JOIN series_analysis_title_states AS s
WHERE c.legacy_id = 'analysis-campaign-smoke'
  AND (SELECT fixture_parent.legacy_id
       FROM game_titles AS fixture_parent
       WHERE fixture_parent.id = s.game_title_id) LIKE 'analysis-campaign-smoke-%';
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'analysis-campaign-smoke-queued-job'),
       'analysis-campaign-smoke-queued-job', pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-queued'), 0,
       'stale-version', 1, NULL, 'queued', 'match_mutation', accepted_at, accepted_at
FROM series_analysis_campaigns
WHERE series_analysis_campaigns.legacy_id = 'analysis-campaign-smoke';
INSERT INTO series_analysis_jobs (id, legacy_id, game_title_id, input_revision, algorithm_version,
                                  artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at, started_at,
                                  lease_owner, lease_attempt_id, legacy_lease_attempt_id, lease_fencing_token, lease_expires_at,
                                  lease_validation_contract_id)
SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'analysis-campaign-smoke-before-job'),
       'analysis-campaign-smoke-before-job', pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-before'), 0,
       'series-analysis-v5', 4, 'series-analysis-artifact-v4-full-validation-v1', 'running', 'match_mutation',
       accepted_at - CAST('1 second' AS interval), accepted_at - CAST('1 second' AS interval),
       accepted_at - CAST('1 second' AS interval), 'worker-before',
       pg_temp.fixture_uuid('series_analysis_job_attempts', 'attempt-before'), 'attempt-before', 1,
       clock_timestamp() + CAST('10 minutes' AS interval), 'series-analysis-artifact-v4-full-validation-v1'
FROM series_analysis_campaigns
WHERE series_analysis_campaigns.legacy_id = 'analysis-campaign-smoke'

UNION ALL

SELECT pg_temp.fixture_uuid('series_analysis_jobs', 'analysis-campaign-smoke-after-job'),
       'analysis-campaign-smoke-after-job', pg_temp.fixture_uuid('game_titles', 'analysis-campaign-smoke-after'), 0,
       'series-analysis-v5', 4, 'series-analysis-artifact-v4-full-validation-v1', 'running', 'match_mutation',
       accepted_at + CAST('1 second' AS interval), accepted_at + CAST('1 second' AS interval),
       accepted_at + CAST('1 second' AS interval), 'worker-after',
       pg_temp.fixture_uuid('series_analysis_job_attempts', 'attempt-after'), 'attempt-after', 1,
       clock_timestamp() + CAST('10 minutes' AS interval), 'series-analysis-artifact-v4-full-validation-v1'
FROM series_analysis_campaigns
WHERE series_analysis_campaigns.legacy_id = 'analysis-campaign-smoke';
DELETE FROM game_titles
WHERE game_titles.legacy_id = 'analysis-campaign-smoke-deleted';",
        )
        .await?;

    database.execute(r"
        UPDATE series_radar_title_states
        SET generation = 8
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_radar_title_states.game_title_id) LIKE 'analysis-campaign-smoke-%'
        ", &[]).await?;
    let mut peer = crate::identity::fixtures::connect(&database_url).await?;
    let (first, second) = tokio::join!(
        expand_pending_campaign_targets(&mut database, 64),
        expand_pending_campaign_targets(&mut peer, 64)
    );
    assert_eq!(first? + second?, 5);
    assert_eq!(expand_pending_campaign_targets(&mut database, 64).await?, 0);
    let rows = database
        .query(
            r"
                SELECT t.legacy_game_title_id AS game_title_id, t.status AS target_status, r.status AS request_status,
                       (SELECT fixture_parent.legacy_id
                        FROM series_analysis_jobs AS fixture_parent
                        WHERE fixture_parent.id = r.assigned_job_id) AS assigned_job_id,
                       r.legacy_assigned_attempt_id AS assigned_attempt_id
                FROM series_analysis_campaign_targets AS t LEFT JOIN series_analysis_job_requests AS r ON r.legacy_id = t.legacy_job_request_id
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_analysis_campaigns AS fixture_parent
                       WHERE fixture_parent.id = t.campaign_id) = $1
                ORDER BY t.legacy_game_title_id
                ",
            &[&CAMPAIGN_ID],
        )
        .await?
        .into_iter()
        .map(|row| {
            Ok::<_, tokio_postgres::Error>((
                row.try_get::<_, String>("game_title_id")?,
                row.try_get::<_, String>("target_status")?,
                row.try_get::<_, Option<String>>("request_status")?,
                row.try_get::<_, Option<String>>("assigned_job_id")?,
                row.try_get::<_, Option<String>>("assigned_attempt_id")?,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(
        rows,
        vec![
            (
                String::from("analysis-campaign-smoke-after"),
                String::from("running"),
                Some(String::from("assigned")),
                Some(String::from("analysis-campaign-smoke-after-job")),
                Some(String::from("attempt-after")),
            ),
            (
                String::from("analysis-campaign-smoke-before"),
                String::from("expanded"),
                Some(String::from("pending")),
                None,
                None,
            ),
            (
                String::from("analysis-campaign-smoke-deleted"),
                String::from("skipped_title_deleted"),
                None,
                None,
                None,
            ),
            (
                String::from("analysis-campaign-smoke-new"),
                String::from("expanded"),
                Some(String::from("pending")),
                Some(campaign_stable_id(
                    "analysis-job",
                    &campaign_target_for("analysis-campaign-smoke-new"),
                )),
                None,
            ),
            (
                String::from("analysis-campaign-smoke-queued"),
                String::from("expanded"),
                Some(String::from("pending")),
                Some(String::from("analysis-campaign-smoke-queued-job")),
                None,
            ),
        ]
    );
    let projection = database
        .query_one(
            r"
                SELECT c.expanded_count, c.terminal_count, c.skipped_count, c.status, o.status AS operation_status,
                       (SELECT pending_forced_run_count
                        FROM series_analysis_title_states
                        WHERE game_title_id = (SELECT id FROM game_titles WHERE legacy_id='analysis-campaign-smoke-before')) AS forced_runs, (SELECT input_revision
                        FROM series_analysis_jobs
                        WHERE legacy_id = 'analysis-campaign-smoke-queued-job') AS queued_revision, (SELECT validation_contract_id
                        FROM series_analysis_jobs
                        WHERE legacy_id = 'analysis-campaign-smoke-queued-job') AS queued_validation_contract,
                       (SELECT bool_and(r.legacy_id IS NULL OR r.validation_contract_id IS NOT DISTINCT FROM t.validation_contract_id)
                        FROM series_analysis_campaign_targets AS t
                             LEFT JOIN series_analysis_job_requests AS r ON r.legacy_id = t.legacy_job_request_id
                        WHERE (SELECT fixture_parent.legacy_id
                               FROM series_analysis_campaigns AS fixture_parent
                               WHERE fixture_parent.id = t.campaign_id) = c.legacy_id) AS request_tuple_propagated
                FROM series_analysis_campaigns AS c
                     INNER JOIN series_analysis_operation_requests AS o ON o.legacy_id = (SELECT fixture_parent.legacy_id
                                                                                          FROM series_analysis_operation_requests AS fixture_parent
                                                                                          WHERE fixture_parent.id = c.operation_request_id)
                WHERE c.legacy_id = $1
                ",
            &[&CAMPAIGN_ID],
        )
        .await?;
    assert_eq!(projection.try_get::<_, i32>("expanded_count")?, 5);
    assert_eq!(projection.try_get::<_, i32>("terminal_count")?, 1);
    assert_eq!(projection.try_get::<_, i32>("skipped_count")?, 1);
    assert_eq!(projection.try_get::<_, String>("status")?, "running");
    assert_eq!(
        projection.try_get::<_, String>("operation_status")?,
        "running"
    );
    assert_eq!(projection.try_get::<_, i32>("forced_runs")?, 1);
    assert_eq!(projection.try_get::<_, i64>("queued_revision")?, 9);
    assert_eq!(
        projection
            .try_get::<_, Option<String>>("queued_validation_contract")?
            .as_deref(),
        Some("series-analysis-artifact-v4-full-validation-v1")
    );
    assert!(projection.try_get::<_, bool>("request_tuple_propagated")?);

    let queued_bindings: bool = database.query_one(
        r"
            SELECT bool_and((SELECT fixture_parent.legacy_id
                             FROM series_radar_basis_identities AS fixture_parent
                             WHERE fixture_parent.id = series_analysis_jobs.radar_basis_id) IS NULL
                        AND radar_generation = 8)
            FROM series_analysis_jobs
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = series_analysis_jobs.game_title_id) LIKE 'analysis-campaign-smoke-%'
              AND status = 'queued'
            ",
        &[],
    ).await?.try_get(0)?;
    assert!(
        queued_bindings,
        "new and coalesced campaign jobs must inherit current radar intent"
    );
    cleanup_campaign_expansion_fixture(&database).await?;
    Ok(())
}

fn campaign_target_for(game_title_id: &str) -> CampaignTarget {
    CampaignTarget {
        campaign_id: String::from(CAMPAIGN_ID),
        game_title_id: String::from(game_title_id),
        input_revision: 0,
        algorithm_version: String::from("series-analysis-v5"),
        artifact_schema_version: 4,
        validation_contract_id: Some(String::from(
            "series-analysis-artifact-v4-full-validation-v1",
        )),
        accepted_at: SystemTime::UNIX_EPOCH,
        operation_id: String::from(CAMPAIGN_OPERATION_ID),
        trigger: String::from("manual"),
    }
}

async fn cleanup_campaign_expansion_fixture(database: &Client) -> SmokeResult {
    database
        .execute(
            r"
                DELETE FROM series_analysis_operation_requests
                WHERE series_analysis_operation_requests.legacy_id = $1
                ",
            &[&CAMPAIGN_OPERATION_ID],
        )
        .await?;
    database
        .execute(
            r"
                DELETE FROM game_titles
                WHERE game_titles.legacy_id = ANY($1)
                ",
            &[&vec![
                "analysis-campaign-smoke-new",
                "analysis-campaign-smoke-queued",
                "analysis-campaign-smoke-before",
                "analysis-campaign-smoke-after",
                "analysis-campaign-smoke-deleted",
            ]],
        )
        .await?;
    Ok(())
}
