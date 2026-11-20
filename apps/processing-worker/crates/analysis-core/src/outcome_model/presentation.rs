use serde_json::{Value, json};

use super::{FoldScore, MINIMUM_IMPROVED_FOLDS, OutcomeModelAnalysis};

impl OutcomeModelAnalysis {
    /// Model summary and the crown certainty. Rank signals stay internal: their stability is
    /// part of the model quality, while their candidates are no longer published.
    #[must_use]
    pub(crate) fn aggregate_json(&self) -> Value {
        json!({
            "modelVersion": "rank-bt-v1",
            "status": self.quality.wire(),
            "reasonCodes": self.reason_codes,
            "heldEventCount": self.held_event_count,
            "matchCount": self.match_count,
            "improvedFoldCount": self.improved_fold_count,
            "requiredImprovedFoldCount": MINIMUM_IMPROVED_FOLDS,
            "foldScores": self.fold_scores.iter().map(FoldScore::json).collect::<Vec<_>>(),
            "crownCertainty": {
                "status": self.quality.wire(),
                "bootstrapIterations": self.crown.bootstrap_iterations,
                "successfulIterations": self.crown.successful_iterations,
                "leaderChangeCount": self.crown.leader_change_count,
                "shares": self.crown.shares.iter().map(|(member_id, share)| json!({ "memberId": member_id, "share": share })).collect::<Vec<_>>(),
            },
        })
    }
}
