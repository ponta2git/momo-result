//! Semantic validation shared by calculation and the reopened, full artifact validator.
use super::{PayloadError, ScopeResources, schema};
use crate::{
    contract::ScopeRef,
    outlook::{
        EXAMPLE_SIZE, MAX_WINDOW, Period, Reference, Summary, Window, availability, average,
        example_distance, rank_sum,
    },
    stats::quality_status,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct OutlookSet {
    summaries: BTreeMap<ScopeRef, Summary>,
    references: BTreeMap<String, Reference>,
}

fn require(valid: bool) -> Result<(), PayloadError> {
    valid.then_some(()).ok_or(PayloadError::ReferenceMismatch)
}
fn same_average(actual: f64, sum: usize, count: usize) -> bool {
    (actual - average(sum, count)).abs() < 1e-12
}

pub(super) fn summary(
    payload: &Value,
    scope: &ScopeRef,
    count: u64,
) -> Result<Summary, PayloadError> {
    schema::validate_outlook_summary(payload)?;
    super::validate_scope(payload.get("scope"), scope)?;
    let summary: Summary = serde_json::from_value(payload.clone())?;
    let n = summary.scope.match_count;
    let t = summary.source.title_match_count;
    require(t <= 25_000 && n <= t && summary.quality_status == quality_status(n))?;
    require(summary.players.len() == if n == 0 { 0 } else { 4 })?;
    if count != u64::try_from(summary.players.len())? {
        return Err(PayloadError::ItemCountMismatch);
    }
    require(summary.players.windows(2).all(|pair| {
        pair.first()
            .zip(pair.last())
            .is_some_and(|(a, b)| a.member_id < b.member_id)
    }))?;
    for player in &summary.players {
        require(
            (n..=4 * n).contains(&player.rank_sum)
                && same_average(player.average_rank, player.rank_sum, n),
        )?;
    }
    require(
        summary
            .players
            .iter()
            .map(|player| player.rank_sum)
            .sum::<usize>()
            == 10 * n,
    )?;
    match (&summary.period, n) {
        (None, 0) => {}
        (Some(period), 1..) => {
            validate_period(period, t)?;
            require(period.end_sequence - period.start_sequence + 1 >= n)?;
        }
        _ => return Err(PayloadError::ReferenceMismatch),
    }
    if *scope == ScopeRef::Overall {
        require(n == t)?;
    }
    validate_recent(&summary)?;
    let members = summary
        .recent
        .players
        .iter()
        .map(|p| p.member_id.as_str())
        .collect::<BTreeSet<_>>();
    require(
        summary
            .players
            .iter()
            .all(|p| members.contains(p.member_id.as_str())),
    )?;
    require(summary.best_windows.len() == members.len() * 2)?;
    let mut seen = BTreeSet::new();
    for preview in &summary.best_windows {
        require(
            members.contains(preview.member_id.as_str())
                && [50, 100].contains(&preview.window_size)
                && seen.insert((&preview.member_id, preview.window_size)),
        )?;
        require(preview.status == availability(t >= preview.window_size))?;
        match &preview.window {
            Some(window) => {
                require(t >= preview.window_size && window.size == preview.window_size)?;
                validate_window(window, t)?;
            }
            None => require(t < preview.window_size)?,
        }
    }
    Ok(summary)
}

fn validate_recent(summary: &Summary) -> Result<(), PayloadError> {
    let recent = &summary.recent;
    let t = summary.source.title_match_count;
    let n = t.min(EXAMPLE_SIZE);
    require(recent.match_count == n && recent.quality_status == quality_status(n))?;
    let members = recent
        .players
        .iter()
        .map(|p| p.member_id.as_str())
        .collect::<BTreeSet<_>>();
    require(members.len() == if n == 0 { 0 } else { 4 })?;
    require(
        recent.players.len() == members.len()
            && recent.joint_ranks.len() == if n == 0 { 0 } else { 6 },
    )?;
    match (&recent.period, n) {
        (None, 0) => {}
        (Some(period), 1..) => {
            validate_period(period, t)?;
            require(period.end_sequence == t && period.start_sequence == t - n + 1)?;
        }
        _ => return Err(PayloadError::ReferenceMismatch),
    }
    for player in &recent.players {
        require(
            player.rank_counts.iter().sum::<usize>() == n
                && rank_sum(&player.rank_counts) == player.rank_sum
                && same_average(player.average_rank, player.rank_sum, n),
        )?;
    }
    for rank in 0..4 {
        require(
            recent
                .players
                .iter()
                .filter_map(|p| p.rank_counts.get(rank))
                .sum::<usize>()
                == n,
        )?;
    }
    let mut pairs = BTreeSet::new();
    for joint in &recent.joint_ranks {
        let a = recent
            .players
            .iter()
            .find(|p| p.member_id == joint.member_a_id)
            .ok_or(PayloadError::ReferenceMismatch)?;
        let b = recent
            .players
            .iter()
            .find(|p| p.member_id == joint.member_b_id)
            .ok_or(PayloadError::ReferenceMismatch)?;
        require(a.member_id < b.member_id && pairs.insert((&a.member_id, &b.member_id)))?;
        for (rank, row) in joint.rank_counts.iter().enumerate() {
            require(
                row.get(rank) == Some(&0)
                    && Some(&row.iter().sum::<usize>()) == a.rank_counts.get(rank),
            )?;
            require(
                Some(
                    &joint
                        .rank_counts
                        .iter()
                        .filter_map(|r| r.get(rank))
                        .sum::<usize>(),
                ) == b.rank_counts.get(rank),
            )?;
        }
    }
    Ok(())
}

pub(super) fn reference(
    payload: &Value,
    scope: &ScopeRef,
    member_id: &str,
    count: u64,
) -> Result<Reference, PayloadError> {
    schema::validate_outlook_reference(payload)?;
    super::validate_scope(payload.get("scope"), scope)?;
    let reference: Reference = serde_json::from_value(payload.clone())?;
    let t = reference.source.title_match_count;
    require(
        *scope == ScopeRef::Overall
            && reference.member_id == member_id
            && (1..=25_000).contains(&t)
            && reference.scope.match_count == t,
    )?;
    if count != u64::try_from(reference.best_windows.len() + reference.examples.types.len())? {
        return Err(PayloadError::ItemCountMismatch);
    }
    require(reference.recent_rank_counts.iter().sum::<usize>() == t.min(EXAMPLE_SIZE))?;
    require(reference.best_windows.len() == t.min(MAX_WINDOW))?;
    for (index, window) in reference.best_windows.iter().enumerate() {
        require(window.size == index + 1)?;
        validate_window(window, t)?;
    }
    let examples = &reference.examples;
    require(examples.status == availability(t >= EXAMPLE_SIZE))?;
    if t < EXAMPLE_SIZE {
        require(examples.types.is_empty())?;
    } else {
        require((1..=1771.min(t - 19)).contains(&examples.types.len()))?;
    }
    let mut seen = BTreeSet::new();
    for example in &examples.types {
        require(
            example.rank_counts.iter().sum::<usize>() == EXAMPLE_SIZE
                && seen.insert(example.rank_counts)
                && rank_sum(&example.rank_counts) == example.window.rank_sum
                && example.window.size == EXAMPLE_SIZE,
        )?;
        validate_window(&example.window, t)?;
    }
    require(examples.types.windows(2).all(|pair| {
        pair.first().zip(pair.last()).is_some_and(|(a, b)| {
            example_distance(&a.rank_counts, &reference.recent_rank_counts)
                .cmp(&example_distance(
                    &b.rank_counts,
                    &reference.recent_rank_counts,
                ))
                .then_with(|| {
                    b.window
                        .period
                        .end_sequence
                        .cmp(&a.window.period.end_sequence)
                })
                .then_with(|| a.rank_counts.cmp(&b.rank_counts))
                .is_lt()
        })
    }))?;
    Ok(reference)
}

fn validate_period(period: &Period, t: usize) -> Result<(), PayloadError> {
    require(
        period.start_sequence > 0
            && period.end_sequence >= period.start_sequence
            && period.end_sequence <= t
            && period.started_at <= period.ended_at,
    )?;
    require(
        (period.start_sequence == period.end_sequence)
            == (period.start_match_id == period.end_match_id),
    )
}

fn validate_window(window: &Window, t: usize) -> Result<(), PayloadError> {
    validate_period(&window.period, t)?;
    let h = window.size;
    require(
        (1..=MAX_WINDOW).contains(&h)
            && h <= t
            && window.period.end_sequence - window.period.start_sequence + 1 == h
            && (h..=4 * h).contains(&window.rank_sum)
            && same_average(window.average_rank, window.rank_sum, h),
    )
}

impl OutlookSet {
    pub(super) fn add_summary(
        &mut self,
        scope: ScopeRef,
        summary: Summary,
    ) -> Result<(), PayloadError> {
        require(self.summaries.insert(scope, summary).is_none())
    }
    pub(super) fn add_reference(&mut self, reference: Reference) -> Result<(), PayloadError> {
        require(
            self.references
                .insert(reference.member_id.clone(), reference)
                .is_none(),
        )
    }
    pub(super) fn finish(
        self,
        scopes: &BTreeMap<ScopeRef, ScopeResources>,
        title_id: Option<&str>,
    ) -> Result<(), PayloadError> {
        let expected = scopes
            .keys()
            .filter(|s| matches!(s, ScopeRef::Overall | ScopeRef::Season { .. }))
            .collect::<BTreeSet<_>>();
        require(self.summaries.keys().collect::<BTreeSet<_>>() == expected)?;
        let overall = self
            .summaries
            .get(&ScopeRef::Overall)
            .ok_or(PayloadError::ResourceSetMismatch)?;
        require(title_id.is_none_or(|title| overall.source.game_title_id == title))?;
        let members = overall
            .players
            .iter()
            .map(|p| p.member_id.as_str())
            .collect::<BTreeSet<_>>();
        require(
            self.references
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                == members,
        )?;
        let contexts = &scopes
            .get(&ScopeRef::Overall)
            .ok_or(PayloadError::ResourceSetMismatch)?
            .context_periods;
        for (scope, summary) in &self.summaries {
            let aggregate = &scopes
                .get(scope)
                .ok_or(PayloadError::ResourceSetMismatch)?
                .aggregate;
            require(
                u64::try_from(summary.scope.match_count)? == aggregate.match_count
                    && summary
                        .players
                        .iter()
                        .map(|p| p.member_id.clone())
                        .collect::<BTreeSet<_>>()
                        == aggregate.member_ids,
            )?;
            require(
                summary.source == overall.source
                    && summary.recent == overall.recent
                    && summary.best_windows == overall.best_windows,
            )?;
            if let Some(period) = &summary.period {
                validate_endpoints(period, contexts)?;
            }
        }
        if let Some(period) = &overall.recent.period {
            validate_endpoints(period, contexts)?;
        }
        for reference in self.references.values() {
            let recent = overall
                .recent
                .players
                .iter()
                .find(|p| p.member_id == reference.member_id)
                .ok_or(PayloadError::ReferenceMismatch)?;
            require(reference.source == overall.source)?;
            require(reference.recent_rank_counts == recent.rank_counts)?;
            for window in reference
                .best_windows
                .iter()
                .chain(reference.examples.types.iter().map(|e| &e.window))
            {
                validate_endpoints(&window.period, contexts)?;
            }
            for preview in overall
                .best_windows
                .iter()
                .filter(|p| p.member_id == reference.member_id)
            {
                require(
                    preview.window.as_ref() == reference.best_windows.get(preview.window_size - 1),
                )?;
            }
        }
        Ok(())
    }
}

fn validate_endpoints(
    period: &Period,
    contexts: &BTreeMap<String, (u64, String)>,
) -> Result<(), PayloadError> {
    let start = contexts
        .get(&period.start_match_id)
        .ok_or(PayloadError::ReferenceMismatch)?;
    let end = contexts
        .get(&period.end_match_id)
        .ok_or(PayloadError::ReferenceMismatch)?;
    require(
        start.0 == u64::try_from(period.start_sequence)?
            && start.1 == period.started_at
            && end.0 == u64::try_from(period.end_sequence)?
            && end.1 == period.ended_at,
    )
}
