use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use tokio_postgres::{
    Transaction,
    types::{Json, Type},
};

use super::{
    AnalysisSource, Comparison, MAXIMUM_SNAPSHOT_BYTES, PreparedNotification, SkipReason,
    comparison,
    types::{AnalysisData, NotificationMatch, SeasonRanks},
};
use crate::notifications::{NotificationEnvelope, NotificationKind};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    game_title_name: String,
    members: BTreeMap<String, String>,
    seasons: BTreeMap<String, String>,
    matches: Vec<NotificationMatch>,
}

pub(super) async fn prepare(
    transaction: &Transaction<'_>,
    source: AnalysisSource<'_>,
    comparison: Box<Comparison>,
) -> Result<Result<PreparedNotification, SkipReason>, tokio_postgres::Error> {
    let reservation = comparison.reservation;
    let current = &comparison.current;
    let changed = &comparison.changes;
    let match_ids: Vec<_> = changed.matches.keys().collect();
    let season_ids: Vec<_> = changed.seasons.iter().collect();
    let row = transaction
        .query_typed_one(
            include_str!("snapshot.sql"),
            &[
                (&source.game_title_id, Type::TEXT),
                (&match_ids, Type::TEXT_ARRAY),
                (&source.job_id, Type::TEXT),
                (&current.identity.artifact_id, Type::TEXT),
                (&source.input_revision, Type::INT8),
                (&season_ids, Type::TEXT_ARRAY),
                (&MAXIMUM_SNAPSHOT_BYTES, Type::INT4),
            ],
        )
        .await?;
    if !row.try_get::<_, bool>("enabled")? {
        return Ok(Err(SkipReason::SettingOff));
    }
    let occurred_at: Option<String> = row.try_get("occurred_at")?;
    let generation: String = row.try_get("generation")?;
    let result = (|| {
        // Decode straight from the bounded JSONB row into the wire snapshot. A generic Value
        // tree would allocate every object key and intermediate collection inside the gate.
        let Json(snapshot) = row
            .try_get::<_, Option<Json<Snapshot>>>("body")
            .map_err(|_error| SkipReason::InvalidSnapshot)?
            .ok_or(SkipReason::PayloadBound)?;
        validate(&snapshot, changed)?;
        let overall = comparison::ranks(
            &snapshot.members,
            comparison.previous.as_artifact(),
            current,
            None,
        )?;
        let seasons = snapshot
            .seasons
            .into_iter()
            .map(|(id, name)| {
                Ok(SeasonRanks {
                    ranks: comparison::ranks(
                        &snapshot.members,
                        comparison.previous.as_artifact(),
                        current,
                        Some(&id),
                    )?,
                    season_id: id,
                    season_name: name,
                })
            })
            .collect::<Result<Vec<_>, SkipReason>>()?;
        let envelope = NotificationEnvelope::new(
            NotificationKind::AnalysisCompleted,
            source.job_id,
            occurred_at.ok_or(SkipReason::InvalidSnapshot)?,
            generation,
            AnalysisData {
                game_title_id: source.game_title_id,
                game_title_name: snapshot.game_title_name,
                disposition: "published",
                previous_analysis: comparison
                    .previous
                    .as_artifact()
                    .map(|artifact| artifact.identity.clone()),
                current_analysis: current.identity.clone(),
                matches: snapshot.matches,
                overall,
                seasons,
            },
        );
        let prepared = reservation.prepare(&envelope)?;
        tracing::info!(event = "analysis_notification_prepared", notification_id = %envelope.notification_id(),
            job_id = %source.job_id, input_revision = source.input_revision,
            previous_artifact_id = ?comparison.previous.as_artifact().map(|artifact| &artifact.identity.artifact_id),
            current_artifact_id = %current.identity.artifact_id);
        Ok(prepared)
    })();
    Ok(result)
}

fn validate(snapshot: &Snapshot, changes: &comparison::Changes) -> Result<(), SkipReason> {
    if snapshot.members.len() != 4
        || snapshot
            .members
            .keys()
            .any(|id| id.is_empty() || id.len() > 200)
        || snapshot.seasons.keys().ne(changes.seasons.iter())
        || snapshot.matches.len() != changes.matches.len()
    {
        return Err(SkipReason::InvalidSnapshot);
    }
    let mut seen = BTreeSet::new();
    for m in &snapshot.matches {
        let Some(expected) = changes.matches.get(&m.match_id) else {
            return Err(SkipReason::InvalidSnapshot);
        };
        let mut players = m.players.each_ref().map(|player| &player.member_id);
        let mut ranks = m.players.each_ref().map(|player| player.rank);
        players.sort_unstable();
        ranks.sort_unstable();
        if expected.source_revision != m.source_revision
            || expected.season_id != m.season_id
            || expected.map_id != m.map_id
            || !seen.insert(&m.match_id)
            || players.into_iter().ne(snapshot.members.keys())
            || ranks != [1, 2, 3, 4]
            || m.players.iter().any(|player| {
                player.ginji_count < 0
                    || snapshot.members.get(&player.member_id) != Some(&player.display_name)
            })
            || m.ginji_total
                != m.players
                    .iter()
                    .map(|player| i64::from(player.ginji_count))
                    .sum::<i64>()
            || m.match_no_in_event < 1
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(())
}
