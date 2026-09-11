use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnalysisIdentity {
    pub(super) artifact_id: String,
    pub(super) input_revision: String,
    pub(super) algorithm_version: String,
    pub(super) artifact_schema_version: i32,
    pub(super) validation_contract_id: Option<String>,
}

impl AnalysisIdentity {
    pub(super) fn comparable_with(&self, other: &Self) -> bool {
        self.algorithm_version == other.algorithm_version
            && self.artifact_schema_version == other.artifact_schema_version
            && self.validation_contract_id.is_some()
            && self.validation_contract_id == other.validation_contract_id
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RankSample {
    pub(super) match_count: u32,
    pub(super) average_rank: Option<f64>,
}

impl RankSample {
    pub(super) const EMPTY: Self = Self {
        match_count: 0,
        average_rank: None,
    };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RankComparison {
    pub(super) member_id: String,
    pub(super) display_name: String,
    pub(super) before: Option<RankSample>,
    pub(super) after: RankSample,
    pub(super) delta: Option<f64>,
    pub(super) comparison: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct MatchIdentity {
    pub(super) source_revision: String,
    pub(super) season_id: String,
    pub(super) map_id: String,
}

pub(super) type Ranks = BTreeMap<String, RankSample>;

#[derive(Clone)]
pub(super) struct Artifact {
    pub(super) identity: AnalysisIdentity,
    // None means overall; a named key is a season across all maps.
    pub(super) scopes: BTreeMap<Option<String>, Ranks>,
    pub(super) matches: BTreeMap<String, MatchIdentity>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MatchPlayer {
    pub(super) member_id: String,
    pub(super) display_name: String,
    pub(super) rank: i32,
    pub(super) ginji_count: i32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NotificationMatch {
    pub(super) match_id: String,
    pub(super) source_revision: String,
    pub(super) held_event_id: String,
    pub(super) held_date_iso: String,
    pub(super) match_no_in_event: i32,
    pub(super) played_at: String,
    pub(super) map_name: String,
    pub(super) season_id: String,
    pub(super) season_name: String,
    pub(super) owner_name: String,
    pub(super) players: [MatchPlayer; 4],
    pub(super) ginji_total: i64,
    pub(super) note: Option<String>,
    #[serde(skip_serializing)]
    pub(super) map_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SeasonRanks {
    pub(super) season_id: String,
    pub(super) season_name: String,
    pub(super) ranks: [RankComparison; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnalysisData<'a> {
    pub(super) game_title_id: &'a str,
    pub(super) game_title_name: String,
    pub(super) disposition: &'static str,
    pub(super) previous_analysis: Option<AnalysisIdentity>,
    pub(super) current_analysis: AnalysisIdentity,
    pub(super) matches: Vec<NotificationMatch>,
    pub(super) overall: [RankComparison; 4],
    pub(super) seasons: Vec<SeasonRanks>,
}
