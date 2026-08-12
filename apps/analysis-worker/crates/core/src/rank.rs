use serde_json::{Value, json};
use std::sync::Arc;

use crate::model::{IncidentCounts, MatchPlayerRow};

mod bootstrap;
mod encoding;
mod evaluation;
mod outcomes;
mod presentation;
mod solver;

const FOLD_COUNT: usize = 5;
const BOOTSTRAP_ITERATIONS: usize = 128;
const BOOTSTRAP_SEED: u64 = 0x6d6f_6d6f_7261_6e6b;
const MINIMUM_IMPORTANCE: f64 = 0.0001;
const MINIMUM_MATCH_COUNT: usize = 32;
const MINIMUM_EVENT_COUNT: usize = 8;
const OK_EVENT_COUNT: usize = 20;
const MINIMUM_IMPROVED_FOLDS: usize = 4;
const SIGNAL_COUNT: usize = 7;
const PLAY_ORDER_COUNT: usize = 4;
const PLAYER_COUNT: usize = 4;
const ADJUSTMENT_COUNT: usize = PLAY_ORDER_COUNT + PLAYER_COUNT;
const FULL_FEATURE_COUNT: usize = SIGNAL_COUNT + ADJUSTMENT_COUNT;
const PROBABILITY_FLOOR: f64 = 1e-15;
const ARMIJO_FACTOR: f64 = 0.0001;
const PIVOT_FLOOR: f64 = 1e-12;
const TIE_TOLERANCE: f64 = 1e-10;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum SignalKind {
    Revenue,
    Destination,
    PlusStation,
    MinusStation,
    CardStation,
    CardShop,
    Ginji,
}

impl SignalKind {
    const ALL: [Self; SIGNAL_COUNT] = [
        Self::Revenue,
        Self::Destination,
        Self::PlusStation,
        Self::MinusStation,
        Self::CardStation,
        Self::CardShop,
        Self::Ginji,
    ];

    const fn index(self) -> usize {
        match self {
            Self::Revenue => 0,
            Self::Destination => 1,
            Self::PlusStation => 2,
            Self::MinusStation => 3,
            Self::CardStation => 4,
            Self::CardShop => 5,
            Self::Ginji => 6,
        }
    }

    const fn code(self) -> &'static str {
        match self {
            Self::Revenue => "revenue",
            Self::Destination => "destination",
            Self::PlusStation => "plus_station",
            Self::MinusStation => "minus_station",
            Self::CardStation => "card_station",
            Self::CardShop => "card_shop",
            Self::Ginji => "ginji",
        }
    }

    const fn raw_value(self, row: &MatchPlayerRow) -> i32 {
        match self {
            Self::Revenue => row.revenue_man_yen,
            Self::Destination => row.incidents.destination,
            Self::PlusStation => row.incidents.plus_station,
            Self::MinusStation => row.incidents.minus_station,
            Self::CardStation => row.incidents.card_station,
            Self::CardShop => row.incidents.card_shop,
            Self::Ginji => row.incidents.suri_no_ginji,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Quality {
    Ok,
    Reference,
    NoTarget,
}

impl Quality {
    const fn wire(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Reference => "reference",
            Self::NoTarget => "no_target",
        }
    }
}

#[derive(Clone, Debug)]
struct FoldScore {
    fold: usize,
    held_event_count: usize,
    comparison_count: usize,
    baseline_log_loss: f64,
    full_log_loss: f64,
    baseline_brier_score: f64,
    full_brier_score: f64,
}

impl FoldScore {
    fn improved(&self) -> bool {
        self.full_log_loss < self.baseline_log_loss
    }

    fn json(&self) -> Value {
        json!({
            "fold": self.fold,
            "heldEventCount": self.held_event_count,
            "comparisonCount": self.comparison_count,
            "baselineLogLoss": self.baseline_log_loss,
            "fullLogLoss": self.full_log_loss,
            "baselineBrierScore": self.baseline_brier_score,
            "fullBrierScore": self.full_brier_score,
            "fullModelImproved": self.improved(),
        })
    }
}

#[derive(Clone, Debug)]
struct Signal {
    kind: SignalKind,
    direction: &'static str,
    importance: f64,
    fold_importances: Vec<f64>,
    fold_comparison_counts: Vec<usize>,
    stable: bool,
}

#[derive(Clone, Debug)]
struct PlayerSignals {
    member_id: String,
    signals: Vec<Signal>,
}

#[derive(Clone, Debug)]
struct UnexpectedWin {
    match_index: usize,
    match_id: String,
    held_event_id: String,
    match_no_in_event: i32,
    played_at: String,
    expected_rank: f64,
    rank: i32,
    revenue_man_yen: i32,
    incidents: IncidentCounts,
}

impl UnexpectedWin {
    fn summary_json(&self) -> Value {
        json!({
            "matchId": self.match_id,
            "heldEventId": self.held_event_id,
            "matchNoInEvent": self.match_no_in_event,
            "playedAt": self.played_at,
            "expectedRank": self.expected_rank,
            "actualRank": self.rank,
            "evidence": self.evidence_json(),
        })
    }

    fn detail_json(&self) -> Value {
        json!({
            "matchIndex": self.match_index,
            "matchId": self.match_id,
            "heldEventId": self.held_event_id,
            "matchNoInEvent": self.match_no_in_event,
            "playedAt": self.played_at,
            "expectedRank": self.expected_rank,
            "actualRank": self.rank,
            "evidence": self.evidence_json(),
        })
    }

    fn evidence_json(&self) -> Value {
        json!({
            "revenueManYen": self.revenue_man_yen,
            "destinationCount": self.incidents.destination,
            "plusStationCount": self.incidents.plus_station,
            "minusStationCount": self.incidents.minus_station,
            "cardStationCount": self.incidents.card_station,
            "cardShopCount": self.incidents.card_shop,
            "ginjiCount": self.incidents.suri_no_ginji,
        })
    }
}

#[derive(Clone, Debug)]
struct PlayerUnexpectedWins {
    member_id: String,
    total_win_count: usize,
    wins: Vec<UnexpectedWin>,
}

#[derive(Clone, Debug)]
struct CrownCertainty {
    bootstrap_iterations: usize,
    successful_iterations: usize,
    leader_change_count: usize,
    shares: Vec<(String, f64)>,
}

#[derive(Clone, Debug)]
pub(super) struct RankAnalysis {
    quality: Quality,
    reason_codes: Vec<&'static str>,
    held_event_count: usize,
    match_count: usize,
    improved_fold_count: usize,
    fold_scores: Vec<FoldScore>,
    player_signals: Vec<PlayerSignals>,
    unexpected_wins: Vec<PlayerUnexpectedWins>,
    crown: CrownCertainty,
}

#[derive(Clone, Debug)]
struct SourceRow {
    member_index: usize,
    rank: i32,
}

#[derive(Clone, Debug)]
struct EncodedRow {
    source: SourceRow,
    signals: [f64; SIGNAL_COUNT],
    adjustments: [f64; ADJUSTMENT_COUNT],
}

#[derive(Clone, Debug)]
struct EncodedMatch {
    match_id: Arc<str>,
    match_no_in_event: i32,
    played_at: Arc<str>,
    rows: Vec<EncodedRow>,
}

#[derive(Clone, Debug)]
struct EncodedEvent {
    held_event_id: Arc<str>,
    played_at: Arc<str>,
    matches: Vec<EncodedMatch>,
}

#[derive(Clone, Copy, Debug)]
struct Observation<const N: usize> {
    features: [f64; N],
    outcome: f64,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct MatchKey {
    event_index: usize,
    match_index: usize,
}

#[derive(Clone, Debug)]
struct PairRecord {
    match_key: MatchKey,
    left_member_index: usize,
    right_member_index: usize,
    full: Observation<FULL_FEATURE_COUNT>,
    baseline: Observation<ADJUSTMENT_COUNT>,
}

#[derive(Clone, Debug)]
struct Fit<const N: usize> {
    coefficients: [f64; N],
}

#[derive(Clone, Debug)]
struct FoldEvaluation {
    score: FoldScore,
    test_events: Vec<EncodedEvent>,
    test_pairs: Vec<PairRecord>,
    full_fit: Fit<FULL_FEATURE_COUNT>,
}

pub(super) fn analyze(rows: &[&MatchPlayerRow], players: &[String]) -> RankAnalysis {
    evaluation::analyze(rows, players)
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "rank test-data conversion failures indicate a broken fixture generator"
)]
mod tests {
    use super::*;

    fn row(match_index: usize, event_index: usize, player: usize) -> MatchPlayerRow {
        let match_index_i32 =
            i32::try_from(match_index).unwrap_or_else(|_| panic!("test match index exceeds i32"));
        let player_i32 =
            i32::try_from(player).unwrap_or_else(|_| panic!("test player index exceeds i32"));
        let rank = (player_i32 + match_index_i32).rem_euclid(4) + 1;
        MatchPlayerRow {
            match_id: format!("match-{match_index:03}"),
            match_revision: 1,
            played_at: format!("2026-01-{:02}T00:00:00.000000Z", event_index + 1),
            held_event_id: format!("event-{event_index:02}"),
            match_no_in_event: match_index_i32.rem_euclid(4) + 1,
            season_master_id: String::from("season-1"),
            map_master_id: String::from("map-1"),
            member_id: format!("player-{player}"),
            play_order: player_i32 + 1,
            rank,
            total_assets_man_yen: 10_000 + rank * 100,
            revenue_man_yen: (5 - rank) * 1_000 + player_i32,
            incidents: IncidentCounts {
                destination: 5 - rank,
                plus_station: player_i32,
                minus_station: rank,
                card_station: match_index_i32.rem_euclid(3),
                card_shop: player_i32.rem_euclid(2),
                suri_no_ginji: i32::from(rank == 4),
            },
        }
    }

    fn dataset() -> Vec<MatchPlayerRow> {
        (0..32)
            .flat_map(|match_index| {
                (0..4).map(move |player| row(match_index, match_index / 4, player))
            })
            .collect()
    }

    #[test]
    fn rank_model_is_deterministic_for_input_order() {
        let rows = dataset();
        let forward = rows.iter().collect::<Vec<_>>();
        let mut reverse = forward.clone();
        reverse.reverse();
        let players = crate::model::player_order(&forward);

        let first = analyze(&forward, &players).aggregate_json();
        let second = analyze(&reverse, &players).aggregate_json();

        assert_eq!(first, second);
        assert_eq!(
            first.get("modelVersion").and_then(Value::as_str),
            Some("rank-bt-v1")
        );
        assert_eq!(
            first
                .get("foldScores")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(5)
        );
    }

    #[test]
    fn small_sample_is_explicitly_no_target() {
        let rows = dataset();
        let sample = rows.iter().take(16).collect::<Vec<_>>();
        let players = crate::model::player_order(&sample);
        let result = analyze(&sample, &players).aggregate_json();

        assert_eq!(
            result.get("status").and_then(Value::as_str),
            Some("no_target")
        );
        assert_eq!(
            result.get("reasonCodes").and_then(Value::as_array).cloned(),
            Some(vec![
                Value::String(String::from("insufficient_matches")),
                Value::String(String::from("insufficient_events")),
            ])
        );
        assert_eq!(result.get("matchCount").and_then(Value::as_u64), Some(4));
        assert_eq!(
            result.get("heldEventCount").and_then(Value::as_u64),
            Some(1)
        );
    }
}
