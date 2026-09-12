use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use tokio_postgres::{Transaction, types::Json};

use super::{
    Comparison, KIND, MAXIMUM_SNAPSHOT_BYTES, PreparedNotification, SkipReason, comparison,
    types::{AnalysisData, NotificationMatch, SeasonRanks},
};
use crate::{notifications::NotificationEnvelope, series_analysis::control::ClaimedJob};

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
    claim: &ClaimedJob,
    comparison: Comparison,
    reused: bool,
) -> Result<Result<PreparedNotification, SkipReason>, tokio_postgres::Error> {
    let current = if reused {
        comparison.previous.as_deref()
    } else {
        Some(comparison.current.as_ref())
    };
    let Some(current) = current else {
        return Ok(Err(SkipReason::InvalidSnapshot));
    };
    let changed = if reused {
        match comparison::Changes::unchanged(current) {
            Ok(changes) => changes,
            Err(reason) => return Ok(Err(reason)),
        }
    } else {
        comparison.changes
    };
    let match_ids: Vec<_> = changed.matches.keys().collect();
    let season_ids: Vec<_> = changed.seasons.iter().collect();
    let row = transaction
        .query_one(
            include_str!("snapshot.sql"),
            &[
                &claim.game_title_id,
                &match_ids,
                &claim.job_id,
                &current.identity.artifact_id,
                &claim.input_revision,
                &season_ids,
                &MAXIMUM_SNAPSHOT_BYTES,
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
        validate(&snapshot, &changed)?;
        let overall = comparison::ranks(
            &snapshot.members,
            comparison.previous.as_deref(),
            current,
            None,
            reused,
        )?;
        let seasons = snapshot
            .seasons
            .into_iter()
            .map(|(id, name)| {
                Ok(SeasonRanks {
                    ranks: comparison::ranks(
                        &snapshot.members,
                        comparison.previous.as_deref(),
                        current,
                        Some(&id),
                        reused,
                    )?,
                    season_id: id,
                    season_name: name,
                })
            })
            .collect::<Result<Vec<_>, SkipReason>>()?;
        let envelope = NotificationEnvelope {
            notification_id: format!("result:{KIND}:{}", claim.job_id),
            kind: KIND,
            schema_version: 1,
            source_job_id: &claim.job_id,
            occurred_at: occurred_at.ok_or(SkipReason::InvalidSnapshot)?,
            settings_generation: generation,
            data: AnalysisData {
                game_title_id: &claim.game_title_id,
                game_title_name: snapshot.game_title_name,
                disposition: if reused { "reused" } else { "published" },
                previous_analysis: comparison
                    .previous
                    .as_ref()
                    .map(|artifact| artifact.identity.clone()),
                current_analysis: current.identity.clone(),
                matches: snapshot.matches,
                overall,
                seasons,
            },
        };
        let prepared = comparison.reservation.prepare(&envelope)?;
        tracing::info!(event = "analysis_notification_prepared", notification_id = %envelope.notification_id,
            job_id = %claim.job_id, input_revision = claim.input_revision,
            previous_artifact_id = ?envelope.data.previous_analysis.as_ref().map(|identity| &identity.artifact_id),
            current_artifact_id = %envelope.data.current_analysis.artifact_id);
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
