//! Production control paths against synthetic records in the explicitly isolated database.

use momo_analysis_core::radar::{self as calculator, RadarSourceSnapshot};

use super::*;
use crate::{
    notifications::NotificationSink,
    series_analysis::{
        config::AnalysisConsumerConfig,
        control::{self, PublicationResult},
        input_repository,
        radar_prepare::{self, Preparation},
    },
};

mod freshness;
mod manual;
mod publication;

async fn clean(client: &Client) -> SmokeResult {
    client.execute(r"
        DELETE FROM series_analysis_job_requests
        WHERE series_analysis_job_requests.legacy_game_title_id = $1 OR series_analysis_job_requests.legacy_id = 'radar-waiting-normal'
        ", &[&TITLE_ID]).await?;
    client
        .execute(
            r"
            DELETE FROM matches
            WHERE (SELECT fixture_parent.legacy_id
                   FROM game_titles AS fixture_parent
                   WHERE fixture_parent.id = matches.game_title_id) = $1
            ",
            &[&TITLE_ID],
        )
        .await?;
    client
        .execute(
            r"
                DELETE FROM held_events
                WHERE held_events.legacy_id LIKE 'analysis-radar-smoke-event-%'
                ",
            &[],
        )
        .await?;
    cleanup_database(client).await
}

async fn seed(client: &Client) -> SmokeResult {
    clean(client).await?;
    prepare_owned_attempt(client).await?;
    client
        .execute(
            r"
            DELETE FROM series_analysis_jobs
            WHERE series_analysis_jobs.legacy_id = $1
            ",
            &[&JOB_ID],
        )
        .await?;
    client
        .execute(
            r"
            DELETE FROM matches
            WHERE matches.legacy_id = $1
            ",
            &[&MATCH_ID],
        )
        .await?;
    let source: RadarSourceSnapshot = serde_json::from_str(include_str!(
        "../../../../../../docs/schemas/fixtures/series-analysis/radar-source-v1.json"
    ))?;
    for (index, game) in source.matches.iter().enumerate() {
        let event = format!("analysis-radar-smoke-event-{}", game.order.held_event_id);
        let id = format!("analysis-radar-smoke-match-{index}");
        client
            .execute(
                r"
            INSERT INTO held_events (id, legacy_id, session_id, held_date_iso, start_at)
            VALUES (pg_temp.fixture_uuid('held_events', $1), $1, NULL,
                    CAST(pg_catalog.timezone('UTC', CAST(CAST($2 AS text) AS timestamptz)) AS date),
                    CAST(CAST($2 AS text) AS timestamptz))
            ON CONFLICT (id) DO NOTHING
            ",
                &[&event, &game.order.played_at],
            )
            .await?;
        client
            .execute(
                r"
            INSERT INTO matches (id, legacy_id, held_event_id, legacy_held_event_id, match_no_in_event, game_title_id,
                                 layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_account_id,
                                 created_by_member_id, analysis_revision)
            VALUES (pg_temp.fixture_uuid('matches', $1), $1, pg_temp.fixture_uuid('held_events', $2), $2, $3,
                    pg_temp.fixture_uuid('game_titles', $4), 'momotetsu_2', pg_temp.fixture_uuid('season_masters', $5),
                    pg_temp.fixture_uuid('members', 'member_ponta'), pg_temp.fixture_uuid('map_masters', $6),
                    CAST(CAST($7 AS text) AS timestamptz), pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
                    pg_temp.fixture_uuid('members', 'member_ponta'), 1)
            ",
                &[
                    &id,
                    &event,
                    &game.order.match_no_in_event,
                    &TITLE_ID,
                    &SEASON_ID,
                    &MAP_ID,
                    &game.order.played_at,
                ],
            )
            .await?;
        for (position, (player, member)) in game.players.iter().zip(MEMBER_IDS).enumerate() {
            let play_order = i32::try_from(position + 1)?;
            client.execute(r"
                INSERT INTO match_players (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen)
                VALUES (pg_temp.fixture_uuid('matches', $1), pg_temp.fixture_uuid('members', $2), $3, $4, $5, $6)
                ", &[&id,&member,&play_order,&player.rank,&player.total_assets_man_yen,&player.revenue_man_yen]).await?;
        }
    }
    client
        .execute(
            r"
        UPDATE series_analysis_title_states
        SET input_revision = 1, pending_work = FALSE
        WHERE (SELECT fixture_parent.legacy_id
               FROM game_titles AS fixture_parent
               WHERE fixture_parent.id = series_analysis_title_states.game_title_id) = $1
        ",
            &[&TITLE_ID],
        )
        .await?;
    client
        .execute(
            r"
        INSERT INTO series_radar_title_states (game_title_id)
        VALUES (pg_temp.fixture_uuid('game_titles', $1))
        ON CONFLICT DO NOTHING
        ",
            &[&TITLE_ID],
        )
        .await?;
    Ok(())
}

async fn operation(
    client: &Client,
    id: &str,
    kind: &str,
    candidate: &str,
    basis: Option<&str>,
    preview: Option<&str>,
) -> SmokeResult {
    if matches!(kind, "candidate" | "restore") {
        let origin = if kind == "restore" {
            "restore"
        } else {
            "generated"
        };
        client.execute(r"
            INSERT INTO series_radar_candidates (id, legacy_id, game_title_id, legacy_game_title_id, basis_id, status, origin_kind)
            VALUES (pg_temp.fixture_uuid('series_radar_candidates', $1), $1, pg_temp.fixture_uuid('game_titles', $2), $2,
                    pg_temp.fixture_uuid('series_radar_bases', $3), 'pending', $4)
            ", &[&candidate,&TITLE_ID,&basis,&origin]).await?;
    }
    client
        .execute(
            r"
        INSERT INTO series_radar_operations (id, legacy_id, game_title_id, legacy_game_title_id, kind, candidate_id,
                                             basis_id, preview_id, requested_by, legacy_requested_by, idempotency_key_hash, request_fingerprint)
        VALUES (pg_temp.fixture_uuid('series_radar_operations', $1), $1, pg_temp.fixture_uuid('game_titles', $2), $2, $3,
                pg_temp.fixture_uuid('series_radar_candidates', $4), pg_temp.fixture_uuid('series_radar_bases', $5),
                pg_temp.fixture_uuid('series_radar_previews', $6), pg_temp.fixture_uuid('momo_login_accounts', 'account_ponta'),
                'account_ponta', $1, $1)
        ",
            &[&id, &TITLE_ID, &kind, &candidate, &basis, &preview],
        )
        .await?;
    Ok(())
}

async fn claim_next(
    client: &mut Client,
    config: &AnalysisConsumerConfig,
) -> SmokeResult<ClaimedJob> {
    control::radar::materialize_pending(client, 10).await?;
    let job_id: String = client
        .query_one(
            r"
                SELECT series_analysis_jobs.legacy_id AS id
                FROM series_analysis_jobs
                WHERE (SELECT fixture_parent.legacy_id
                       FROM game_titles AS fixture_parent
                       WHERE fixture_parent.id = series_analysis_jobs.game_title_id) = $1
                  AND status = 'queued'
                ",
            &[&TITLE_ID],
        )
        .await?
        .try_get(0)?;
    match control::claim_job(client, &job_id, config).await?.value {
        ClaimResult::Claimed(claim) => Ok(claim),
        other @ (ClaimResult::RecoveredCurrentJob
        | ClaimResult::Busy
        | ClaimResult::MissingOrTerminal
        | ClaimResult::UnsupportedVersion(_)
        | ClaimResult::NotYetAvailable { .. }) => {
            Err(format!("expected a durable queued claim, got {other:?}").into())
        }
    }
}

async fn prepare(client: &mut Client, claim: &ClaimedJob) -> SmokeResult<(TempDir, Preparation)> {
    let loaded = input_repository::load_job_input(client, &identity(claim)).await?;
    let context = loaded.context.ok_or("preparation context")?;
    let prepared = radar_prepare::compute(&loaded.input, &context)?;
    let directory = TempDir::new()?;
    radar_prepare::write(directory.path(), &prepared, 64 * 1024 * 1024)?;
    Ok((directory, prepared))
}

fn identity(claim: &ClaimedJob) -> momo_analysis_core::child::AnalysisAttemptIdentity {
    momo_analysis_core::child::AnalysisAttemptIdentity {
        job_id: claim.job_id.clone(),
        game_title_id: claim.game_title_id.clone(),
        input_revision: claim.input_revision,
        artifact_id: artifact_id_for_attempt(&claim.attempt_id),
    }
}

async fn finish_preparation(
    client: &mut Client,
    claim: &ClaimedJob,
    config: &AnalysisConsumerConfig,
    directory: &TempDir,
) -> SmokeResult {
    let outcome = control::publish(
        client,
        claim,
        config,
        directory.path(),
        &mut AttemptMetrics::default(),
        tokio::time::Instant::now() + config.execution_limits.finalization_timeout,
    )
    .await?;
    assert_eq!(outcome.value, PublicationResult::Prepared);
    Ok(())
}

async fn candidate_state(client: &Client, candidate: &str) -> SmokeResult<(String, String)> {
    let row = client.query_one(r"
        SELECT c.status, p.status
        FROM series_radar_candidates AS c
             INNER JOIN series_radar_previews AS p ON (SELECT fixture_parent.legacy_id
                                                       FROM series_radar_candidates AS fixture_parent
                                                       WHERE fixture_parent.id = p.candidate_id) = c.legacy_id
        WHERE c.legacy_id = $1
        ORDER BY p.updated_at DESC
        LIMIT 1
        ", &[&candidate]).await?;
    Ok((row.try_get(0)?, row.try_get(1)?))
}

async fn prepare_candidate(
    client: &mut Client,
    config: &AnalysisConsumerConfig,
    candidate: &str,
) -> SmokeResult<String> {
    operation(
        client,
        &format!("{candidate}-create"),
        "candidate",
        candidate,
        None,
        None,
    )
    .await?;
    let claim = claim_next(client, config).await?;
    let (directory, prepared) = prepare(client, &claim).await?;
    assert_eq!(prepared.evaluation_snapshot.matches.len(), 40);
    assert_eq!(prepared.scopes.len(), 4);
    finish_preparation(client, &claim, config, &directory).await?;
    assert_eq!(
        candidate_state(client, candidate).await?,
        ("ready".to_owned(), "ready".to_owned())
    );
    let row = client.query_one(r"
        SELECT p.legacy_id AS id, cardinality(p.scope_keys), (SELECT count(*)
                FROM series_radar_preview_scopes AS s
                WHERE (SELECT fixture_parent.legacy_id
                       FROM series_radar_previews AS fixture_parent
                       WHERE fixture_parent.id = s.preview_id) = p.legacy_id), c.source_input_revision, c.result IS NOT NULL
        FROM series_radar_previews AS p
             INNER JOIN series_radar_candidates AS c ON c.legacy_id = (SELECT fixture_parent.legacy_id
                                                                       FROM series_radar_candidates AS fixture_parent
                                                                       WHERE fixture_parent.id = p.candidate_id)
        WHERE c.legacy_id = $1
        ", &[&candidate]).await?;
    assert_eq!(row.try_get::<_, i32>(1)?, 4);
    assert_eq!(row.try_get::<_, i64>(2)?, 4);
    assert_eq!(row.try_get::<_, i64>(3)?, 1);
    assert!(row.try_get::<_, bool>(4)?);
    row.try_get(0).map_err(Into::into)
}
