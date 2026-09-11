use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use tokio_postgres::Transaction;

use super::{
    Comparison, KIND, PreparedNotification, SkipReason, comparison,
    types::{AnalysisData, MatchIdentity, NotificationMatch, SeasonRanks},
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
        comparison.previous.as_ref()
    } else {
        Some(&comparison.current)
    };
    let Some(current) = current else {
        return Ok(Err(SkipReason::InvalidSnapshot));
    };
    let changed = if reused {
        comparison::Changes {
            matches: BTreeMap::new(),
            seasons: current.scopes.keys().flatten().cloned().collect(),
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
            ],
        )
        .await?;
    if !row.try_get::<_, bool>("enabled")? {
        return Ok(Err(SkipReason::SettingOff));
    }
    let body: Option<serde_json::Value> = row.try_get("body")?;
    let occurred_at: Option<String> = row.try_get("occurred_at")?;
    let generation: String = row.try_get("generation")?;
    let result = (|| {
        let snapshot: Snapshot = serde_json::from_value(body.ok_or(SkipReason::PayloadBound)?)
            .map_err(|_error| SkipReason::InvalidSnapshot)?;
        validate(&snapshot, &changed)?;
        let overall = comparison::ranks(
            &snapshot.members,
            comparison.previous.as_ref(),
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
                        comparison.previous.as_ref(),
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
        let identity = MatchIdentity {
            source_revision: m.source_revision.clone(),
            season_id: m.season_id.clone(),
            map_id: m.map_id.clone(),
        };
        let players: BTreeSet<_> = m.players.iter().map(|player| &player.member_id).collect();
        let ranks: BTreeSet<_> = m.players.iter().map(|player| player.rank).collect();
        if changes.matches.get(&m.match_id) != Some(&identity)
            || !seen.insert(&m.match_id)
            || players.iter().copied().ne(snapshot.members.keys())
            || ranks != BTreeSet::from([1, 2, 3, 4])
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
