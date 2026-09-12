use std::collections::{BTreeMap, BTreeSet};

use super::{
    MAXIMUM_LISTED_MATCHES, MAXIMUM_SEASONS, SkipReason,
    types::{Artifact, MatchIdentity, RankComparison, RankSample},
};

pub(super) struct Changes {
    pub(super) matches: BTreeMap<String, MatchIdentity>,
    pub(super) seasons: BTreeSet<String>,
}

impl Changes {
    pub(super) fn unchanged(artifact: &Artifact) -> Result<Self, SkipReason> {
        let seasons: BTreeSet<_> = artifact
            .scopes
            .keys()
            .flatten()
            .take(MAXIMUM_SEASONS + 1)
            .cloned()
            .collect();
        if seasons.len() > MAXIMUM_SEASONS {
            return Err(SkipReason::PayloadBound);
        }
        Ok(Self {
            matches: BTreeMap::new(),
            seasons,
        })
    }
}

/// Compare revisions and membership, stopping before an unpublishable listing is materialized.
/// Deletions affect season aggregates but never become listed matches.
pub(super) fn changes(before: Option<&Artifact>, after: &Artifact) -> Result<Changes, SkipReason> {
    if before.is_some_and(|before| std::ptr::eq(before, after)) {
        return Changes::unchanged(after);
    }
    let mut matches = BTreeMap::new();
    let mut seasons = BTreeSet::new();
    for (id, current) in &after.matches {
        let previous = before.and_then(|artifact| artifact.matches.get(id));
        if previous != Some(current) {
            if matches.len() == MAXIMUM_LISTED_MATCHES {
                return Err(SkipReason::PayloadBound);
            }
            matches.insert(id.clone(), current.clone());
            seasons.insert(current.season_id.clone());
            if let Some(previous) = previous {
                seasons.insert(previous.season_id.clone());
            }
            if seasons.len() > MAXIMUM_SEASONS {
                return Err(SkipReason::PayloadBound);
            }
        }
    }
    if let Some(before) = before {
        for (id, previous) in &before.matches {
            if !after.matches.contains_key(id) {
                seasons.insert(previous.season_id.clone());
                if seasons.len() > MAXIMUM_SEASONS {
                    return Err(SkipReason::PayloadBound);
                }
            }
        }
    }
    // Deletion-only changes already have affected seasons; do not confuse them with a no-op.
    if seasons.is_empty() {
        return Changes::unchanged(after);
    }
    Ok(Changes { matches, seasons })
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
