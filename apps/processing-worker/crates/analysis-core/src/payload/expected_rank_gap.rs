//! Semantic checks for the expected-rank gap; the schema owns its bounded shape.
//!
//! The checks bind denominators, partitions, quality and judgement states, the zero-sum gap, and
//! evidence selection to the scope so that an internally inconsistent artifact is never published.

use serde_json::{Map, Value};

use super::{PayloadError, array, required_string, required_u64};
use crate::numeric::exact_i64_as_f64;

const ITEMS: [&str; 5] = [
    "card_shop",
    "plus_station",
    "card_station",
    "minus_station",
    "ginji",
];
const TWO_LEVEL_ITEMS: [&str; 2] = ["minus_station", "ginji"];
const EVIDENCE_LIMIT: u64 = 5;
const MINIMUM_MATCH_COUNT: u64 = 3;
const JUDGED_MATCH_COUNT: u64 = 20;
const MINIMUM_CELL_COUNT: u64 = 3;
const PLAYER_COUNT: u64 = 4;
const RANK_TOTAL_PER_MATCH: f64 = 10.0;
const TOLERANCE: f64 = 1e-9;

fn object(value: &Value) -> Result<&Map<String, Value>, PayloadError> {
    value.as_object().ok_or(PayloadError::InvalidSchema)
}

fn number(value: Option<&Value>) -> Result<Option<f64>, PayloadError> {
    match value {
        Some(Value::Null) => Ok(None),
        Some(found) => found.as_f64().map(Some).ok_or(PayloadError::InvalidSchema),
        None => Err(PayloadError::InvalidSchema),
    }
}

fn as_f64(count: u64) -> Result<f64, PayloadError> {
    exact_i64_as_f64(i64::try_from(count)?).ok_or(PayloadError::InvalidSchema)
}

fn ensure(condition: bool) -> Result<(), PayloadError> {
    condition.then_some(()).ok_or(PayloadError::InvalidSchema)
}

/// Additive quantities let the validator reconcile partitions without repeating the calculation.
#[derive(Clone, Copy, Default)]
struct Totals {
    count: u64,
    expected: f64,
    actual: f64,
}

impl Totals {
    fn add(&mut self, summary: &Value) -> Result<(), PayloadError> {
        let count = required_u64(summary.get("count"))?;
        self.count = self
            .count
            .checked_add(count)
            .ok_or(PayloadError::InvalidSchema)?;
        self.expected = number(summary.get("expectedRank"))?
            .unwrap_or(0.0)
            .mul_add(as_f64(count)?, self.expected);
        self.actual = number(summary.get("averageRank"))?
            .unwrap_or(0.0)
            .mul_add(as_f64(count)?, self.actual);
        Ok(())
    }

    fn reconcile(self, other: Self) -> Result<(), PayloadError> {
        if self.count != other.count {
            return Err(PayloadError::ItemCountMismatch);
        }
        let tolerance = TOLERANCE * as_f64(self.count)?;
        ensure(
            (self.expected - other.expected).abs() <= tolerance
                && (self.actual - other.actual).abs() <= tolerance,
        )
    }

    fn reconcile_summary(self, summary: &Value) -> Result<(), PayloadError> {
        let mut expected = Self::default();
        expected.add(summary)?;
        self.reconcile(expected)
    }

    fn reconcile_scope(self, match_count: u64) -> Result<(), PayloadError> {
        let rank_total = RANK_TOTAL_PER_MATCH * as_f64(match_count)?;
        self.reconcile(Self {
            count: match_count
                .checked_mul(PLAYER_COUNT)
                .ok_or(PayloadError::InvalidSchema)?,
            expected: rank_total,
            actual: rank_total,
        })
    }
}

pub(super) fn validate_aggregate(
    value: &Value,
    players: &[&str],
    match_count: u64,
) -> Result<(), PayloadError> {
    let gap = object(value)?;
    let status = required_string(gap.get("status"))?;
    let reasons = array(gap.get("reasonCodes"))?;
    let layers = array(gap.get("layers"))?;
    let gap_players = array(gap.get("players"))?;
    let items = array(gap.get("items"))?;
    if required_u64(gap.get("matchCount"))? != match_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    if status == "no_target" {
        ensure(
            layers.is_empty()
                && gap_players.is_empty()
                && items.is_empty()
                && reasons.len() == 1
                && gap.get("hasMergedLayers") == Some(&Value::Bool(false)),
        )?;
        return ensure(
            match_count < MINIMUM_MATCH_COUNT
                && reasons.first().and_then(Value::as_str) == Some("insufficient_matches"),
        );
    }
    let judged = status == "ok";
    ensure(
        match_count >= MINIMUM_MATCH_COUNT
            && judged == (match_count >= JUDGED_MATCH_COUNT)
            && (if judged {
                reasons.is_empty()
            } else {
                reasons.len() == 1
                    && reasons.first().and_then(Value::as_str) == Some("insufficient_matches")
            })
            && u64::try_from(players.len())? == PLAYER_COUNT,
    )?;
    let cell_count = match_count
        .checked_mul(PLAYER_COUNT)
        .ok_or(PayloadError::InvalidSchema)?;
    validate_layers(gap, layers, match_count, cell_count)?;
    validate_member_order(gap_players, players)?;
    let mut player_totals = Totals::default();
    for player in gap_players {
        if required_u64(player.get("count"))? != match_count {
            return Err(PayloadError::ItemCountMismatch);
        }
        validate_summary(player, match_count, status)?;
        player_totals.add(player)?;
    }
    player_totals.reconcile_scope(match_count)?;
    if items.len() != ITEMS.len() {
        return Err(PayloadError::InvalidSchema);
    }
    for (item, code) in items.iter().zip(ITEMS) {
        validate_item(item, code, gap_players, match_count, cell_count, status)?;
    }
    Ok(())
}

fn validate_layers(
    gap: &Map<String, Value>,
    layers: &[Value],
    match_count: u64,
    cell_count: u64,
) -> Result<(), PayloadError> {
    let mut seen = std::collections::BTreeSet::new();
    let mut previous_rank = 0;
    let mut counted = 0_u64;
    let mut rank_total = 0.0_f64;
    let mut merged = false;
    for layer in layers {
        let revenue_rank = required_u64(layer.get("revenueRank"))?;
        let levels = array(layer.get("destinationLevels"))?
            .iter()
            .map(|level| required_u64(Some(level)))
            .collect::<Result<Vec<_>, _>>()?;
        let count = required_u64(layer.get("count"))?;
        let expected = number(layer.get("expectedRank"))?.ok_or(PayloadError::InvalidSchema)?;
        ensure(
            revenue_rank >= previous_rank
                && !levels.is_empty()
                && levels.windows(2).all(|pair| pair.first() < pair.get(1))
                && count > 0,
        )?;
        for level in &levels {
            ensure(seen.insert((revenue_rank, *level)))?;
        }
        merged |= levels.len() > 1;
        previous_rank = revenue_rank;
        counted = counted
            .checked_add(count)
            .ok_or(PayloadError::InvalidSchema)?;
        rank_total = expected.mul_add(as_f64(count)?, rank_total);
    }
    if counted != cell_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    // Layer averages reproduce the saved ranks, so the gaps of every layer sum to zero.
    ensure(
        RANK_TOTAL_PER_MATCH
            .mul_add(-as_f64(match_count)?, rank_total)
            .abs()
            <= TOLERANCE * as_f64(cell_count)?
            && gap.get("hasMergedLayers") == Some(&Value::Bool(merged)),
    )
}

fn validate_member_order(entries: &[Value], players: &[&str]) -> Result<(), PayloadError> {
    let order = entries
        .iter()
        .map(|entry| required_string(entry.get("memberId")))
        .collect::<Result<Vec<_>, _>>()?;
    (order == players)
        .then_some(())
        .ok_or(PayloadError::ReferenceMismatch)
}

/// Binds the share, nullable means, quality, and judgement of one summary row.
fn validate_summary(summary: &Value, denominator: u64, status: &str) -> Result<(), PayloadError> {
    let count = required_u64(summary.get("count"))?;
    let share = number(summary.get("share"))?.ok_or(PayloadError::InvalidSchema)?;
    let expected = number(summary.get("expectedRank"))?;
    let average = number(summary.get("averageRank"))?;
    let mean_gap = number(summary.get("meanGap"))?;
    let signal = summary.get("signal").ok_or(PayloadError::InvalidSchema)?;
    let band = number(summary.get("band"))?;
    let expected_quality = if count == 0 {
        "no_target"
    } else if count < MINIMUM_CELL_COUNT {
        "reference"
    } else {
        status
    };
    ensure(
        count <= denominator
            && (share - as_f64(count)? / as_f64(denominator)?).abs() <= TOLERANCE
            && required_string(summary.get("quality"))? == expected_quality,
    )?;
    match (expected, average, mean_gap) {
        (None, None, None) => ensure(count == 0)?,
        (Some(expected), Some(average), Some(mean_gap)) => {
            ensure(count > 0 && (expected - average - mean_gap).abs() <= TOLERANCE)?;
        }
        _ => return Err(PayloadError::InvalidSchema),
    }
    let judged = expected_quality == "ok";
    ensure(judged != signal.is_null() && judged == band.is_some())
}

fn validate_item(
    item: &Value,
    code: &str,
    gap_players: &[Value],
    match_count: u64,
    cell_count: u64,
    status: &str,
) -> Result<(), PayloadError> {
    let item = object(item)?;
    let levels = array(item.get("levels"))?;
    let expected_levels = if TWO_LEVEL_ITEMS.contains(&code) {
        2
    } else {
        3
    };
    ensure(required_string(item.get("item"))? == code && levels.len() == expected_levels)?;
    let mut next_minimum = 0_i64;
    let players = gap_players
        .iter()
        .map(|player| required_string(player.get("memberId")))
        .collect::<Result<Vec<_>, _>>()?;
    let mut overall_total = Totals::default();
    let mut player_totals = vec![Totals::default(); players.len()];
    let mut reported = false;
    let mut judged_levels = Vec::new();
    for (index, level) in levels.iter().enumerate() {
        let minimum = level
            .get("minimumCount")
            .and_then(Value::as_i64)
            .ok_or(PayloadError::InvalidSchema)?;
        let maximum = level
            .get("maximumCount")
            .ok_or(PayloadError::InvalidSchema)?;
        let last = index + 1 == levels.len();
        ensure(minimum == next_minimum && maximum.is_null() == last)?;
        if let Some(maximum) = maximum.as_i64() {
            ensure(maximum >= minimum)?;
            next_minimum = maximum + 1;
        }
        let overall = level.get("overall").ok_or(PayloadError::InvalidSchema)?;
        validate_summary(overall, cell_count, status)?;
        overall_total.add(overall)?;
        reported |= matches!(
            overall.get("signal").and_then(Value::as_str),
            Some("trend" | "hint")
        );
        if overall.get("quality").and_then(Value::as_str) == Some("ok") {
            judged_levels.push(u64::try_from(index)?);
        }
        let by_player = array(level.get("byPlayer"))?;
        validate_member_order(by_player, &players)?;
        let mut level_player_total = Totals::default();
        for (summary, total) in by_player.iter().zip(player_totals.iter_mut()) {
            validate_summary(summary, match_count, status)?;
            total.add(summary)?;
            level_player_total.add(summary)?;
        }
        level_player_total.reconcile_summary(overall)?;
    }
    overall_total.reconcile_scope(match_count)?;
    for (total, player) in player_totals.into_iter().zip(gap_players) {
        total.reconcile_summary(player)?;
    }
    let conclusion = item.get("conclusion").ok_or(PayloadError::InvalidSchema)?;
    ensure(conclusion.is_null() == (status != "ok"))?;
    let background = item.get("background").ok_or(PayloadError::InvalidSchema)?;
    if background.is_null() {
        return ensure(!reported);
    }
    ensure(reported)?;
    validate_background(background, code, &judged_levels)
}

fn validate_background(
    background: &Value,
    code: &str,
    judged_levels: &[u64],
) -> Result<(), PayloadError> {
    let variables = array(background.get("variables"))?
        .iter()
        .map(|variable| required_string(Some(variable)))
        .collect::<Result<Vec<_>, _>>()?;
    let expected_variables = ["revenue_share", "total_assets"]
        .into_iter()
        .chain(ITEMS.into_iter().filter(|item| *item != code))
        .collect::<Vec<_>>();
    ensure(variables == expected_variables)?;
    let rows = array(background.get("rows"))?;
    let levels = rows
        .iter()
        .map(|row| required_u64(row.get("levelIndex")))
        .collect::<Result<Vec<_>, _>>()?;
    ensure(levels == judged_levels)?;
    for row in rows {
        let values = array(row.get("values"))?;
        ensure(values.len() == variables.len())?;
        for (variable, value) in variables.iter().zip(values) {
            if *variable == "total_assets" {
                ensure(value.get("marked") == Some(&Value::Bool(false)))?;
            }
        }
    }
    Ok(())
}

pub(super) fn validate_evidence(
    detail: &Map<String, Value>,
    item_count: u64,
) -> Result<(), PayloadError> {
    let summary = detail
        .get("summary")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let match_count = required_u64(summary.get("matchCount"))?;
    if match_count != item_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    let status = required_string(summary.get("status"))?;
    ensure(if status == "no_target" {
        match_count < MINIMUM_MATCH_COUNT
    } else {
        match_count >= MINIMUM_MATCH_COUNT
            && (status == "ok") == (match_count >= JUDGED_MATCH_COUNT)
    })?;
    let mut match_ids = std::collections::BTreeSet::new();
    let mut match_indices = std::collections::BTreeSet::new();
    let mut listed = 0_u64;
    for (side, count_field, above) in [
        ("above", "aboveCount", true),
        ("below", "belowCount", false),
    ] {
        let rows = array(detail.get(side))?;
        let total = required_u64(summary.get(count_field))?;
        if u64::try_from(rows.len())? != total.min(EVIDENCE_LIMIT) {
            return Err(PayloadError::ItemCountMismatch);
        }
        listed = listed
            .checked_add(total)
            .ok_or(PayloadError::InvalidSchema)?;
        let mut previous: Option<(f64, u64)> = None;
        for row in rows {
            let gap = number(row.get("gap"))?.ok_or(PayloadError::InvalidSchema)?;
            let expected = number(row.get("expectedRank"))?.ok_or(PayloadError::InvalidSchema)?;
            let actual = required_u64(row.get("actualRank"))?;
            let match_index = required_u64(row.get("matchIndex"))?;
            ensure(
                (gap > 0.0) == above
                    && gap != 0.0
                    && (expected - as_f64(actual)? - gap).abs() <= TOLERANCE
                    && (1..=match_count).contains(&match_index)
                    && match_ids.insert(required_string(row.get("matchId"))?)
                    && match_indices.insert(match_index),
            )?;
            // Larger gaps first; equal gaps keep the newer match first.
            if let Some((previous_gap, previous_index)) = previous {
                let ordered = match previous_gap.abs().total_cmp(&gap.abs()) {
                    std::cmp::Ordering::Greater => true,
                    std::cmp::Ordering::Equal => previous_index > match_index,
                    std::cmp::Ordering::Less => false,
                };
                ensure(ordered)?;
            }
            previous = Some((gap, match_index));
        }
    }
    if listed > item_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    ensure(required_string(summary.get("status"))? != "no_target" || listed == 0)
}

/// At most ten references per player survive until the scope's match contexts are consumed.
pub(super) struct EvidenceReference {
    pub(super) match_id: String,
    pub(super) sequence: u64,
    pub(super) played_at: String,
}

pub(super) struct EvidenceReferences {
    pub(super) status: String,
    pub(super) match_count: u64,
    pub(super) rows: Vec<EvidenceReference>,
}

pub(super) fn evidence_references(
    detail: &Map<String, Value>,
) -> Result<EvidenceReferences, PayloadError> {
    let summary = detail.get("summary").ok_or(PayloadError::InvalidSchema)?;
    let rows = array(detail.get("above"))?
        .iter()
        .chain(array(detail.get("below"))?)
        .map(|row| {
            Ok(EvidenceReference {
                match_id: required_string(row.get("matchId"))?.into(),
                sequence: required_u64(row.get("matchIndex"))?,
                played_at: required_string(row.get("playedAt"))?.into(),
            })
        })
        .collect::<Result<_, PayloadError>>()?;
    Ok(EvidenceReferences {
        status: required_string(summary.get("status"))?.into(),
        match_count: required_u64(summary.get("matchCount"))?,
        rows,
    })
}
