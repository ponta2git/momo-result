use serde_json::{Value, json};

use crate::numeric::floor_u8;

use super::{
    BOOTSTRAP_SEED, FOLD_COUNT, FoldScore, MINIMUM_EVENT_COUNT, MINIMUM_IMPORTANCE,
    MINIMUM_IMPROVED_FOLDS, MINIMUM_MATCH_COUNT, OutcomeModelAnalysis, Quality, Signal,
    UnexpectedWin,
};

impl OutcomeModelAnalysis {
    #[must_use]
    pub(crate) fn aggregate_json(&self) -> Value {
        let default_member_id = self
            .player_signals
            .iter()
            .filter_map(|player| {
                player
                    .signals
                    .iter()
                    .filter(|signal| signal.stable)
                    .map(|signal| signal.importance)
                    .max_by(f64::total_cmp)
                    .map(|importance| (&player.member_id, importance))
            })
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .map(|entry| entry.0);
        json!({
            "modelVersion": "rank-bt-v1",
            "status": self.quality.wire(),
            "reasonCodes": self.reason_codes,
            "heldEventCount": self.held_event_count,
            "matchCount": self.match_count,
            "improvedFoldCount": self.improved_fold_count,
            "requiredImprovedFoldCount": MINIMUM_IMPROVED_FOLDS,
            "foldScores": self.fold_scores.iter().map(FoldScore::json).collect::<Vec<_>>(),
            "defaultMemberId": default_member_id,
            "rankSignalsByPlayer": self.player_signals.iter().map(|player| {
                let stable = player.signals.iter().filter(|signal| signal.stable).collect::<Vec<_>>();
                let shares = candidate_shares(&stable);
                json!({
                    "memberId": player.member_id,
                    "status": signal_status(self.quality, &stable),
                    "candidates": stable.iter().enumerate().map(|(index, signal)| signal_json(signal, shares.get(index).copied().flatten())).collect::<Vec<_>>(),
                })
            }).collect::<Vec<_>>(),
            "unexpectedWinsByPlayer": self.unexpected_wins.iter().map(|player| {
                json!({
                    "memberId": player.member_id,
                    "status": unexpected_status(self.quality, player.total_win_count),
                    "totalWinCount": player.total_win_count,
                    "unexpectedWinCount": player.wins.len(),
                    "latest": player.wins.last().map(UnexpectedWin::summary_json),
                    "hasDetails": !player.wins.is_empty(),
                })
            }).collect::<Vec<_>>(),
            "crownCertainty": {
                "status": self.quality.wire(),
                "bootstrapIterations": self.crown.bootstrap_iterations,
                "successfulIterations": self.crown.successful_iterations,
                "leaderChangeCount": self.crown.leader_change_count,
                "shares": self.crown.shares.iter().map(|(member_id, share)| json!({ "memberId": member_id, "share": share })).collect::<Vec<_>>(),
            },
        })
    }

    #[must_use]
    pub(crate) fn signal_drilldown_json(&self, member_id: &str) -> Value {
        let player = self
            .player_signals
            .iter()
            .find(|player| player.member_id == member_id);
        let stable = player
            .map(|player| {
                player
                    .signals
                    .iter()
                    .filter(|signal| signal.stable)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let shares = candidate_shares(&stable);
        json!({
            "kind": "rank_signals",
            "method": {
                "modelVersion": "rank-bt-v1",
                "fixedSeed": BOOTSTRAP_SEED.to_string(),
                "minimumHeldEvents": MINIMUM_EVENT_COUNT,
                "minimumMatches": MINIMUM_MATCH_COUNT,
                "foldCount": FOLD_COUNT,
                "requiredImprovedFoldCount": MINIMUM_IMPROVED_FOLDS,
                "minimumImportance": MINIMUM_IMPORTANCE,
            },
            "status": signal_status(self.quality, &stable),
            "reasonCodes": self.reason_codes,
            "heldEventCount": self.held_event_count,
            "matchCount": self.match_count,
            "improvedFoldCount": self.improved_fold_count,
            "candidates": stable.iter().enumerate().map(|(index, signal)| {
                let mut value = signal_json(signal, shares.get(index).copied().flatten());
                if let Some(object) = value.as_object_mut() {
                    object.insert("foldRows".into(), Value::Array(signal.fold_importances.iter().enumerate().map(|(fold, importance)| {
                        let score = self.fold_scores.get(fold);
                        json!({
                            "fold": score.map_or(fold, |score| score.fold),
                            "heldEventCount": score.map_or(0, |score| score.held_event_count),
                            "comparisonCount": signal.fold_comparison_counts.get(fold).copied().unwrap_or(0),
                            "importance": importance,
                            "supported": *importance > 0.0,
                        })
                    }).collect()));
                }
                value
            }).collect::<Vec<_>>(),
        })
    }

    #[must_use]
    pub(crate) fn unexpected_wins_drilldown_json(&self, member_id: &str) -> Value {
        let player = self
            .unexpected_wins
            .iter()
            .find(|player| player.member_id == member_id);
        let total_win_count = player.map_or(0, |player| player.total_win_count);
        let rows = player.map_or(&[][..], |player| player.wins.as_slice());
        json!({
            "kind": "unexpected_wins",
            "summary": {
                "status": unexpected_status(self.quality, total_win_count),
                "reasonCodes": self.reason_codes,
                "heldEventCount": self.held_event_count,
                "matchCount": self.match_count,
                "totalWinCount": total_win_count,
                "unexpectedWinCount": rows.len(),
            },
            "rows": rows.iter().map(UnexpectedWin::detail_json).collect::<Vec<_>>(),
        })
    }
}

fn signal_json(signal: &Signal, share_percent: Option<u8>) -> Value {
    let support_count = signal
        .fold_importances
        .iter()
        .filter(|importance| **importance > 0.0)
        .count();
    json!({
        "signal": signal.kind.code(),
        "direction": signal.direction,
        "importance": signal.importance,
        "stable": signal.stable,
        "supportCount": support_count,
        "stabilityBand": if signal.stable && support_count == FOLD_COUNT { "high" } else if signal.stable { "medium" } else { "low" },
        "candidateSharePercent": share_percent,
    })
}

fn candidate_shares(signals: &[&Signal]) -> Vec<Option<u8>> {
    if signals.len() <= 1 {
        return vec![None; signals.len()];
    }
    let total = signals.iter().map(|signal| signal.importance).sum::<f64>();
    if !total.is_finite() || total <= 0.0 {
        return vec![None; signals.len()];
    }
    let exact = signals
        .iter()
        .map(|signal| signal.importance / total * 100.0)
        .collect::<Vec<_>>();
    let Some(mut shares) = exact
        .iter()
        .map(|value| percentage_floor(*value))
        .collect::<Option<Vec<_>>>()
    else {
        return vec![None; signals.len()];
    };
    let assigned = shares
        .iter()
        .map(|value| usize::from(*value))
        .sum::<usize>();
    let mut remainder_order = exact
        .iter()
        .enumerate()
        .map(|(index, value)| (index, value - value.floor()))
        .collect::<Vec<_>>();
    remainder_order.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    for (index, _) in remainder_order
        .into_iter()
        .take(100_usize.saturating_sub(assigned))
    {
        if let Some(share) = shares.get_mut(index) {
            *share = share.saturating_add(1);
        }
    }
    shares.into_iter().map(Some).collect()
}

fn percentage_floor(value: f64) -> Option<u8> {
    (value <= 100.0).then_some(())?;
    floor_u8(value)
}

fn signal_status(quality: Quality, signals: &[&Signal]) -> &'static str {
    if quality == Quality::NoTarget || signals.is_empty() {
        "no_target"
    } else if quality == Quality::Ok {
        "ok"
    } else {
        "reference"
    }
}

fn unexpected_status(quality: Quality, total_win_count: usize) -> &'static str {
    if quality == Quality::NoTarget || total_win_count == 0 {
        "no_target"
    } else if total_win_count < 10 {
        "reference"
    } else {
        quality.wire()
    }
}
