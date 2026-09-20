use super::*;

mod release;

const SECOND_MATCH: &str = "analysis-notification-second-match";

pub(super) async fn mark_initial(client: &Client) -> SmokeResult {
    client.execute("UPDATE series_analysis_title_states SET notification_baseline_state='initial', notification_baseline_artifact_id=NULL WHERE game_title_id=$1", &[&TITLE_ID]).await?;
    Ok(())
}

pub(super) async fn requests(
    client: &Client,
    claim: &ClaimedJob,
    triggers: &[&str],
) -> SmokeResult {
    for (index, trigger) in triggers.iter().enumerate() {
        let id = format!("{}-request-{index}", claim.job_id);
        client.execute("INSERT INTO series_analysis_job_requests (id, game_title_id, input_revision, algorithm_version, artifact_schema_version, validation_contract_id, trigger, status, assigned_job_id, assigned_attempt_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'assigned',$8,$9)", &[&id,&claim.game_title_id,&claim.input_revision,&claim.algorithm_version,&claim.artifact_schema_version,&claim.validation_contract_id,trigger,&claim.job_id,&claim.attempt_id]).await?;
    }
    if let Some(trigger) = triggers.first() {
        client
            .execute(
                "UPDATE series_analysis_jobs SET trigger=$2 WHERE id=$1",
                &[&claim.job_id, trigger],
            )
            .await?;
    }
    Ok(())
}

pub(super) async fn fulfill(transaction: &Transaction<'_>, claim: &ClaimedJob) -> SmokeResult {
    transaction.execute("UPDATE series_analysis_job_requests SET status='fulfilled', fulfilled_at=clock_timestamp() WHERE assigned_attempt_id=$1", &[&claim.attempt_id]).await?;
    Ok(())
}

pub(super) async fn assert_baseline(client: &Client, artifact_id: &str) -> SmokeResult {
    let row = client.query_one("SELECT notification_baseline_state, notification_baseline_artifact_id FROM series_analysis_title_states WHERE game_title_id=$1", &[&TITLE_ID]).await?;
    assert_eq!(row.try_get::<_, String>(0)?, "artifact");
    assert_eq!(
        row.try_get::<_, Option<String>>(1)?.as_deref(),
        Some(artifact_id)
    );
    Ok(())
}

pub(super) async fn cleanup(client: &Client) -> SmokeResult {
    client.execute("UPDATE worker_execution_slots SET owner=NULL, task_kind=NULL, job_id=NULL, attempt_id=NULL, holder_preemptible=NULL, lease_expires_at=NULL WHERE job_id IN (SELECT id FROM series_analysis_jobs WHERE game_title_id=$1)", &[&TITLE_ID]).await?;
    client
        .execute(
            "DELETE FROM series_analysis_job_requests WHERE game_title_id=$1",
            &[&TITLE_ID],
        )
        .await?;
    client
        .execute("DELETE FROM matches WHERE game_title_id=$1", &[&TITLE_ID])
        .await?;
    client.execute("UPDATE series_analysis_title_states SET notification_baseline_state='unknown', notification_baseline_artifact_id=NULL WHERE game_title_id=$1", &[&TITLE_ID]).await?;
    cleanup_database(client).await
}

struct Harness {
    client: Client,
    config: AnalysisConsumerConfig,
    received: mpsc::Receiver<Value>,
    server: tokio::task::JoinHandle<SmokeResult>,
    sender: tokio::task::JoinHandle<()>,
    _temporary: TempDir,
}

impl Harness {
    async fn start() -> SmokeResult<Self> {
        let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
        let client = crate::postgres::connect(&database_url).await?;
        cleanup(&client).await?;
        prepare_owned_attempt(&client).await?;
        mark_initial(&client).await?;
        client
            .batch_execute("UPDATE discord_notification_settings SET enabled=true, generation=0")
            .await?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!(
            "http://{}/internal/discord-notifications",
            listener.local_addr()?
        );
        let (sink, driver) =
            NotificationDriver::new(NotificationConfig::http(&endpoint, &"x".repeat(32))?)?;
        let (sent, received) = mpsc::channel(16);
        let server = tokio::spawn(capture(listener, sent, database_url.clone()));
        let sender = tokio::spawn(driver.run());
        let temporary = TempDir::new()?;
        let config = config(&database_url, sink, temporary.path())?;
        Ok(Self {
            client,
            config,
            received,
            server,
            sender,
            _temporary: temporary,
        })
    }

    async fn publish(&mut self, claim: &ClaimedJob, triggers: &[&str]) -> SmokeResult {
        requests(&self.client, claim, triggers).await?;
        publish(&mut self.client, &self.config, claim).await?;
        let row = self.client.query_one("SELECT current_artifact_id FROM series_analysis_title_states WHERE game_title_id=$1", &[&TITLE_ID]).await?;
        assert_baseline(&self.client, &row.try_get::<_, String>(0)?).await
    }

    async fn expect_matches(
        &mut self,
        claim: &ClaimedJob,
        expected: &[&str],
    ) -> SmokeResult<Value> {
        let body = receive(&mut self.received).await?;
        assert_eq!(body.get("sourceJobId"), Some(&json!(claim.job_id)));
        let mut ids = body
            .pointer("/data/matches")
            .and_then(Value::as_array)
            .ok_or("matches")?
            .iter()
            .map(|row| row.get("matchId").and_then(Value::as_str).ok_or("match ID"))
            .collect::<Result<Vec<_>, _>>()?;
        ids.sort_unstable();
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        assert_eq!(ids, expected);
        Ok(body)
    }

    async fn finish(self) -> SmokeResult {
        let Self {
            client,
            config,
            mut received,
            server,
            sender,
            _temporary,
        } = self;
        drop(config);
        tokio::time::timeout(Duration::from_secs(6), sender).await??;
        assert!(
            received.try_recv().is_err(),
            "suppressed jobs and failed HTTP sends must not enqueue/retry notifications"
        );
        server.abort();
        let _server_result = server.await;
        client
            .batch_execute("UPDATE discord_notification_settings SET enabled=true, generation=0")
            .await?;
        cleanup(&client).await
    }
}

async fn add_second(client: &Client) -> SmokeResult {
    client.execute("INSERT INTO matches (id, held_event_id, match_no_in_event, game_title_id, layout_family, season_master_id, owner_member_id, map_master_id, played_at, created_by_account_id, created_by_member_id, analysis_revision) SELECT $2,held_event_id,2,game_title_id,layout_family,season_master_id,owner_member_id,map_master_id,played_at + interval '1 day',created_by_account_id,created_by_member_id,1 FROM matches WHERE id=$1", &[&MATCH_ID,&SECOND_MATCH]).await?;
    client.execute("INSERT INTO match_players (match_id,member_id,play_order,rank,total_assets_man_yen,revenue_man_yen) SELECT $2,member_id,play_order,rank,total_assets_man_yen,revenue_man_yen FROM match_players WHERE match_id=$1", &[&MATCH_ID,&SECOND_MATCH]).await?;
    Ok(())
}

async fn next_revision(
    client: &Client,
    previous: &ClaimedJob,
    label: &str,
) -> SmokeResult<ClaimedJob> {
    let row = client.query_one("UPDATE series_analysis_title_states SET input_revision=input_revision+1, pending_work=true WHERE game_title_id=$1 RETURNING input_revision", &[&TITLE_ID]).await?;
    let advanced = ClaimedJob {
        input_revision: row.try_get(0)?,
        ..previous.clone()
    };
    next_job(client, &advanced, label).await
}

async fn edit_match(client: &Client, match_id: &str) -> SmokeResult {
    client
        .execute(
            "UPDATE matches SET analysis_revision=analysis_revision+1 WHERE id=$1",
            &[&match_id],
        )
        .await?;
    client
        .execute(
            "UPDATE match_players SET revenue_man_yen=revenue_man_yen+10 WHERE match_id=$1",
            &[&match_id],
        )
        .await?;
    Ok(())
}

fn assert_rank_counts(body: &Value, before: u32, after: u32) -> SmokeResult {
    for pointer in ["/data/overall", "/data/seasons/0/ranks"] {
        let ranks = body
            .pointer(pointer)
            .and_then(Value::as_array)
            .ok_or("aggregate ranks")?;
        assert_eq!(ranks.len(), 4);
        for rank in ranks {
            assert_eq!(rank.pointer("/before/matchCount"), Some(&json!(before)));
            assert_eq!(rank.pointer("/after/matchCount"), Some(&json!(after)));
        }
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_coalesced_requests_notify_only_actual_match_changes() -> SmokeResult {
    let mut harness = Harness::start().await?;
    add_second(&harness.client).await?;
    let mut previous = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    harness.publish(&previous, &["match_mutation"]).await?;
    harness
        .expect_matches(&previous, &[MATCH_ID, SECOND_MATCH])
        .await?;

    for (label, triggers) in [
        ("manual-first", ["manual", "match_mutation"]),
        ("mutation-first", ["match_mutation", "manual"]),
    ] {
        edit_match(&harness.client, MATCH_ID).await?;
        let next = next_revision(&harness.client, &previous, label).await?;
        harness.publish(&next, &triggers).await?;
        harness.expect_matches(&next, &[MATCH_ID]).await?;
        previous = next;
    }
    // An accepted mutation request is necessary but does not make unchanged input a change.
    let noop = next_revision(&harness.client, &previous, "noop").await?;
    harness.publish(&noop, &["match_mutation"]).await?;
    harness
        .client
        .execute("DELETE FROM matches WHERE id=$1", &[&SECOND_MATCH])
        .await?;
    let deleted = next_revision(&harness.client, &noop, "deleted").await?;
    harness.publish(&deleted, &["match_mutation"]).await?;
    let deletion = harness.expect_matches(&deleted, &[]).await?;
    assert_eq!(
        deletion.pointer("/data/seasons/0/seasonId"),
        Some(&json!(SEASON_ID))
    );
    assert_rank_counts(&deletion, 2, 1)?;

    // All maintenance kinds suppress even reuse; the first job trigger is not the policy.
    let mut previous = deleted;
    for trigger in [
        "manual",
        "initial_backfill",
        "algorithm_update",
        "artifact_schema_update",
        "validation_contract_update",
    ] {
        let next = next_job(&harness.client, &previous, trigger).await?;
        harness.publish(&next, &[trigger]).await?;
        previous = next;
    }
    harness
        .client
        .execute("DELETE FROM matches WHERE id=$1", &[&MATCH_ID])
        .await?;
    let empty = next_revision(&harness.client, &previous, "empty").await?;
    harness.publish(&empty, &["match_mutation"]).await?;
    let deletion = harness.expect_matches(&empty, &[]).await?;
    assert_rank_counts(&deletion, 1, 0)?;
    harness.finish().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
async fn real_postgres_notification_baseline_advances_only_with_success() -> SmokeResult {
    let mut harness = Harness::start().await?;
    let first = claim(OLD_ATTEMPT_ID, 1, OLD_FENCE)?;
    harness.client.batch_execute("UPDATE discord_notification_settings SET enabled=false WHERE kind='analysis_completed'").await?;
    harness.publish(&first, &["match_mutation"]).await?;
    harness
        .client
        .batch_execute(
            "UPDATE discord_notification_settings SET enabled=true WHERE kind='analysis_completed'",
        )
        .await?;
    add_second(&harness.client).await?;
    let added = next_revision(&harness.client, &first, "after-off").await?;
    harness.publish(&added, &["match_mutation"]).await?;
    harness.expect_matches(&added, &[SECOND_MATCH]).await?;
    // The local receiver always returns 503. Success still consumes this input baseline.
    edit_match(&harness.client, MATCH_ID).await?;
    let changed = next_revision(&harness.client, &added, "after-send-failure").await?;
    harness.publish(&changed, &["match_mutation"]).await?;
    harness.expect_matches(&changed, &[MATCH_ID]).await?;

    harness.client.execute("UPDATE series_analysis_title_states SET notification_baseline_state='unknown', notification_baseline_artifact_id=NULL WHERE game_title_id=$1", &[&TITLE_ID]).await?;
    edit_match(&harness.client, SECOND_MATCH).await?;
    let unknown = next_revision(&harness.client, &changed, "unknown").await?;
    harness.publish(&unknown, &["match_mutation"]).await?;
    edit_match(&harness.client, MATCH_ID).await?;
    let known = next_revision(&harness.client, &unknown, "known-again").await?;
    harness.publish(&known, &["match_mutation"]).await?;
    harness.expect_matches(&known, &[MATCH_ID]).await?;

    // A maintenance publication may include changed input but is never a user notification.
    edit_match(&harness.client, SECOND_MATCH).await?;
    let manual = next_revision(&harness.client, &known, "manual-changed").await?;
    requests(&harness.client, &manual, &["match_mutation"]).await?;
    harness.client.execute("UPDATE series_analysis_job_requests SET assigned_attempt_id='unrelated-attempt' WHERE assigned_job_id=$1", &[&manual.job_id]).await?;
    // A mutation attached to another attempt cannot authorize the manual publication.
    publish(&mut harness.client, &harness.config, &manual).await?;
    assert_baseline(
        &harness.client,
        &artifact_id_for_attempt(&manual.attempt_id),
    )
    .await?;
    let noop = next_revision(&harness.client, &manual, "after-manual").await?;
    harness.publish(&noop, &["match_mutation"]).await?;

    let failed = next_revision(&harness.client, &noop, "failed").await?;
    requests(&harness.client, &failed, &["match_mutation"]).await?;
    let wrong_owner = ClaimedJob {
        fencing_token: failed.fencing_token + 1,
        ..failed
    };
    assert!(
        publish(&mut harness.client, &harness.config, &wrong_owner)
            .await
            .is_err()
    );
    assert_baseline(&harness.client, &artifact_id_for_attempt(&noop.attempt_id)).await?;
    harness.finish().await
}
