use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use super::{
    SkipReason,
    types::{Artifact, MatchIdentity, RankComparison, RankSample, Ranks},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aggregate {
    metrics_by_player: Vec<Metric>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metric {
    member_id: String,
    denominator: u32,
    rank: Average,
}

#[derive(Deserialize)]
struct Average {
    average: Option<f64>,
}

pub(super) fn decode_ranks(bytes: &[u8]) -> Result<Ranks, SkipReason> {
    let aggregate: Aggregate =
        serde_json::from_slice(bytes).map_err(|_error| SkipReason::InvalidSnapshot)?;
    let mut ranks = BTreeMap::new();
    if aggregate.metrics_by_player.len() > 4 {
        return Err(SkipReason::InvalidSnapshot);
    }
    for metric in aggregate.metrics_by_player {
        let sample = RankSample {
            match_count: metric.denominator,
            average_rank: metric.rank.average,
        };
        if metric.member_id.is_empty()
            || metric.member_id.len() > 200
            || !sample
                .average_rank
                .map_or(sample.match_count == 0, |average| {
                    sample.match_count > 0 && (1.0..=4.0).contains(&average)
                })
            || ranks.insert(metric.member_id, sample).is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(ranks)
}

pub(super) struct Changes {
    pub(super) matches: BTreeMap<String, MatchIdentity>,
    pub(super) seasons: BTreeSet<String>,
}

pub(super) fn changes(before: Option<&Artifact>, after: &Artifact) -> Changes {
    let mut matches = BTreeMap::new();
    let mut seasons = BTreeSet::new();
    for (id, current) in &after.matches {
        let previous = before.and_then(|artifact| artifact.matches.get(id));
        if previous != Some(current) {
            matches.insert(id.clone(), current.clone());
            seasons.insert(current.season_id.clone());
            if let Some(previous) = previous {
                seasons.insert(previous.season_id.clone());
            }
        }
    }
    if let Some(before) = before {
        for (id, previous) in &before.matches {
            if !after.matches.contains_key(id) {
                seasons.insert(previous.season_id.clone());
            }
        }
    }
    // Deletion-only changes already have affected seasons; do not confuse them with a no-op.
    if seasons.is_empty() {
        seasons.extend(after.scopes.keys().flatten().cloned());
    }
    Changes { matches, seasons }
}

pub(super) fn ranks(
    members: &BTreeMap<String, String>,
    before: Option<&Artifact>,
    after: &Artifact,
    scope: Option<&str>,
    reused: bool,
) -> Result<[RankComparison; 4], SkipReason> {
    let key = scope.map(str::to_owned);
    let previous = before.and_then(|artifact| artifact.scopes.get(&key));
    let current = after.scopes.get(&key);
    let compatible =
        before.is_none_or(|artifact| artifact.identity.comparable_with(&after.identity));
    for samples in [previous, current].into_iter().flatten() {
        if !samples.is_empty() && samples.keys().ne(members.keys()) {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    members
        .iter()
        .map(|(id, name)| {
            let before_sample =
                previous.map(|samples| samples.get(id).copied().unwrap_or(RankSample::EMPTY));
            let after_sample = current
                .and_then(|samples| samples.get(id))
                .copied()
                .unwrap_or(RankSample::EMPTY);
            let (comparison, delta) = compare(before_sample, after_sample, compatible, reused);
            RankComparison {
                member_id: id.clone(),
                display_name: name.clone(),
                before: before_sample,
                after: after_sample,
                delta,
                comparison,
            }
        })
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|_error| SkipReason::InvalidSnapshot)
}

fn compare(
    before: Option<RankSample>,
    after: RankSample,
    compatible: bool,
    reused: bool,
) -> (&'static str, Option<f64>) {
    if reused {
        return ("reused", after.average_rank.map(|_average| 0.0));
    }
    if !compatible {
        return ("incomparable", None);
    }
    if after.match_count == 0 {
        return ("empty", None);
    }
    before.map_or(("initial", None), |previous| {
        match (previous.average_rank, after.average_rank) {
            (Some(old), Some(new)) => ("comparable", Some(new - old)),
            (None, _) | (_, None) => ("empty", None),
        }
    })
}

#[cfg(test)]
mod tests;
