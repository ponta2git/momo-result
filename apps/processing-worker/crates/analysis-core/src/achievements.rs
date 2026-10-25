//! Lifetime achievement facts. Match statistics and their six-axis scoring basis remain separate.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::model::{AnalysisInputError, PlayerMatchInput};

mod calculate;
mod curve;
pub use curve::AchievementCurve;
#[cfg(test)]
mod tests;

pub const MAXIMUM_ITEMS: usize = 4_096;
pub const MAXIMUM_PROOFS: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleKind {
    Manual,
    TotalAssets,
    Destination,
    SuriNoGinji,
    EventAverageRank,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Definition {
    pub achievement_id: String,
    pub stars: u8,
    pub rule_kind: RuleKind,
    pub threshold: Option<String>,
    pub common: bool,
    pub map_master_ids: Vec<String>,
    pub applies_from: Option<String>,
    pub retired: bool,
    pub fixed_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimKind {
    Direct,
    Import,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimState {
    Achieved,
    Unconfirmed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Claim {
    pub claim_id: String,
    pub achievement_id: String,
    pub member_id: String,
    pub source_kind: ClaimKind,
    pub state: ClaimState,
    pub generation_id: String,
    pub achieved_at: Option<String>,
    pub match_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManualRetirementSource {
    pub achievement_id: String,
    pub claim_id: String,
    pub generation_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EventComposition {
    pub held_event_id: String,
    pub match_count: u32,
    pub title_count: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RetiredAchievement {
    pub achievement_id: String,
    pub players: Vec<PlayerAchievement>,
}

/// Only semantic inputs belong here: mutable labels, audit times and edit versions are excluded.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementInput {
    pub member_ids: Vec<String>,
    pub map_master_ids: Vec<String>,
    pub definitions: Vec<Definition>,
    pub claims: Vec<Claim>,
    pub event_compositions: Vec<EventComposition>,
    pub retired_achievements: Vec<RetiredAchievement>,
    pub retired_manual_sources: Vec<ManualRetirementSource>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofKind {
    Manual,
    Import,
    Derived,
    Automatic,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofState {
    Achieved,
    Unconfirmed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Proof {
    pub kind: ProofKind,
    pub state: ProofState,
    pub claim_id: Option<String>,
    pub generation_id: Option<String>,
    pub source_achievement_id: Option<String>,
    pub match_id: Option<String>,
    pub held_event_id: Option<String>,
    pub achieved_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AchievementStatus {
    Achieved,
    Unconfirmed,
    NotRecorded,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayerAchievement {
    pub member_id: String,
    pub status: AchievementStatus,
    pub first_achieved_at: Option<String>,
    pub date_unknown: bool,
    pub proofs: Vec<Proof>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementItem {
    pub achievement_id: String,
    pub stars: u8,
    pub rule_kind: RuleKind,
    pub threshold: Option<String>,
    pub common: bool,
    pub map_master_ids: Vec<String>,
    pub applies_from: Option<String>,
    pub retired: bool,
    pub players: Vec<PlayerAchievement>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayerPoints {
    pub member_id: String,
    pub earned_points: u32,
    pub score: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PointSummary {
    pub map_master_id: Option<String>,
    pub total_points: u32,
    pub players: Vec<PlayerPoints>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementPayload {
    pub schema_version: u32,
    pub scope: crate::contract::ScopeRef,
    pub game_title_id: String,
    pub achievement_curve: AchievementCurve,
    pub items: Vec<AchievementItem>,
    pub summaries: Vec<PointSummary>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AchievementPreview {
    pub achievement_curve: AchievementCurve,
    pub summary: PointSummary,
}

impl AchievementPreview {
    #[must_use]
    pub fn new(summary: &PointSummary, achievement_curve: AchievementCurve) -> Self {
        let mut summary = summary.clone();
        for player in &mut summary.players {
            player.score = achievement_curve.score(player.earned_points, summary.total_points);
        }
        Self {
            achievement_curve,
            summary,
        }
    }
}

impl AchievementInput {
    /// Existing calculation fixtures have no catalog; runtime replaces this with authoritative rows.
    pub(crate) fn empty_for_matches(rows: &[PlayerMatchInput]) -> Self {
        let mut member_ids = rows
            .iter()
            .map(|row| row.member_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        if member_ids.is_empty() {
            member_ids = ["akane", "eu", "otaka", "ponta"].map(String::from).to_vec();
        }
        Self {
            member_ids,
            map_master_ids: rows
                .iter()
                .map(|row| row.map_master_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            ..Self::default()
        }
    }

    /// Validates and canonically orders the independent title catalog and its durable evidence.
    ///
    /// # Errors
    /// Returns a stable input error for invalid references, duplicate identities or unsafe bounds.
    pub fn normalize(mut self) -> Result<Self, AnalysisInputError> {
        self.member_ids.sort();
        self.map_master_ids.sort();
        self.definitions
            .sort_by(|a, b| a.achievement_id.cmp(&b.achievement_id));
        self.claims.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));
        self.event_compositions
            .sort_by(|a, b| a.held_event_id.cmp(&b.held_event_id));
        self.retired_achievements
            .sort_by(|a, b| a.achievement_id.cmp(&b.achievement_id));
        for saved in &mut self.retired_achievements {
            saved.players.sort_by(|a, b| a.member_id.cmp(&b.member_id));
        }
        self.retired_manual_sources.sort_by(|a, b| {
            (&a.achievement_id, &a.claim_id, &a.generation_id).cmp(&(
                &b.achievement_id,
                &b.claim_id,
                &b.generation_id,
            ))
        });
        let invalid = AnalysisInputError::InvalidAchievements;
        if self.member_ids.len() != 4
            || !unique_ids(&self.member_ids)
            || !unique_ids(&self.map_master_ids)
            || self.map_master_ids.len() > MAXIMUM_ITEMS
            || self.definitions.len() > MAXIMUM_ITEMS
            || self.claims.len() > MAXIMUM_ITEMS * 8
            || self.retired_manual_sources.len() > MAXIMUM_ITEMS * 8
            || self.event_compositions.len() > crate::model::MAXIMUM_PLAYER_MATCH_ROWS / 4
        {
            return Err(invalid);
        }
        for item in &mut self.definitions {
            // Retained for wire compatibility; every active definition evaluates the full history.
            if !item.retired {
                item.applies_from = None;
            }
            item.map_master_ids.sort();
            if let Some(threshold) = &item.threshold {
                item.threshold = Some(
                    DecimalThreshold::parse(threshold)
                        .ok_or(invalid)?
                        .canonical(),
                );
            }
            if !(1..=5).contains(&item.stars)
                || !crate::model::valid_input_id(&item.achievement_id)
                || !unique_ids(&item.map_master_ids)
                || item
                    .map_master_ids
                    .iter()
                    .any(|id| self.map_master_ids.binary_search(id).is_err())
                || item.common != item.map_master_ids.is_empty()
                || item
                    .applies_from
                    .as_ref()
                    .is_some_and(|date| !valid_date(date))
                || !valid_threshold(item)
            {
                return Err(invalid);
            }
        }
        let definitions = self
            .definitions
            .iter()
            .map(|item| (&item.achievement_id, item))
            .collect::<BTreeMap<_, _>>();
        if definitions.len() != self.definitions.len() {
            return Err(invalid);
        }
        if self.event_compositions.windows(2).any(|pair| {
            pair.first().map(|event| &event.held_event_id)
                == pair.get(1).map(|event| &event.held_event_id)
        }) || self.event_compositions.iter().any(|event| {
            !crate::model::valid_input_id(&event.held_event_id)
                || event.match_count == 0
                || event.title_count == 0
                || event.title_count > event.match_count
        }) {
            return Err(invalid);
        }
        self.validate_evidence(&definitions)?;
        Ok(self)
    }

    fn validate_evidence(
        &self,
        definitions: &BTreeMap<&String, &Definition>,
    ) -> Result<(), AnalysisInputError> {
        let invalid = AnalysisInputError::InvalidAchievements;
        let mut roots = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for claim in &self.claims {
            let kind = if claim.source_kind == ClaimKind::Direct {
                "direct"
            } else {
                "import"
            };
            if !definitions.contains_key(&claim.achievement_id)
                || self.member_ids.binary_search(&claim.member_id).is_err()
                || !ids.insert(&claim.claim_id)
                || !roots.insert((&claim.achievement_id, &claim.member_id, kind))
                || (claim.source_kind == ClaimKind::Direct
                    && (definitions
                        .get(&claim.achievement_id)
                        .is_none_or(|item| item.rule_kind != RuleKind::Manual)
                        || claim.state == ClaimState::Unconfirmed
                        || (claim.match_id.is_some() && claim.achieved_at.is_none())))
                || !crate::model::valid_input_id(&claim.claim_id)
                || !crate::model::valid_input_id(&claim.generation_id)
                || claim
                    .achieved_at
                    .as_ref()
                    .is_some_and(|time| !valid_timestamp(time))
                || claim
                    .match_id
                    .as_ref()
                    .is_some_and(|id| !crate::model::valid_input_id(id))
            {
                return Err(invalid);
            }
        }
        let retired = self
            .retired_achievements
            .iter()
            .map(|item| (&item.achievement_id, item))
            .collect::<BTreeMap<_, _>>();
        if retired.len() != self.retired_achievements.len() {
            return Err(invalid);
        }
        if retired.keys().any(|id| !definitions.contains_key(*id)) {
            return Err(invalid);
        }
        let mut allowed = BTreeSet::new();
        for source in &self.retired_manual_sources {
            if !allowed.insert((
                &source.achievement_id,
                &source.claim_id,
                &source.generation_id,
            )) || !ids.contains(&source.claim_id)
                || !crate::model::valid_input_id(&source.generation_id)
                || definitions
                    .get(&source.achievement_id)
                    .is_none_or(|item| !item.retired || item.rule_kind != RuleKind::Manual)
            {
                return Err(invalid);
            }
        }
        for item in &self.definitions {
            if item.retired && item.rule_kind != RuleKind::Manual {
                let saved = retired.get(&item.achievement_id).ok_or(invalid)?;
                if saved
                    .players
                    .iter()
                    .map(|p| p.member_id.clone())
                    .collect::<BTreeSet<_>>()
                    != self.member_ids.iter().cloned().collect::<BTreeSet<_>>()
                    || saved.players.len() != 4
                    || saved.players.iter().any(|player| !valid_player(player))
                {
                    return Err(invalid);
                }
            } else if retired.contains_key(&item.achievement_id) {
                return Err(invalid);
            }
        }
        Ok(())
    }
}

fn unique_ids(ids: &[String]) -> bool {
    ids.iter().all(|id| crate::model::valid_input_id(id))
        && ids.windows(2).all(|pair| pair.first() < pair.get(1))
}

fn valid_threshold(item: &Definition) -> bool {
    if item.rule_kind == RuleKind::Manual {
        return item.threshold.is_none();
    }
    let Some(value) = item
        .threshold
        .as_ref()
        .and_then(|value| DecimalThreshold::parse(value))
    else {
        return false;
    };
    match item.rule_kind {
        RuleKind::EventAverageRank => {
            (1..=4).contains(&value.whole) && (value.whole < 4 || value.fraction.is_empty())
        }
        RuleKind::TotalAssets | RuleKind::Destination | RuleKind::SuriNoGinji => {
            value.whole > 0 && value.whole <= 2_147_483_647 && value.fraction.is_empty()
        }
        RuleKind::Manual => false,
    }
}

/// A rule threshold needs only a nonnegative integer and decimal digits. Keeping those digits
/// avoids rounding a value just below a quarter rank up to that quarter.
struct DecimalThreshold<'a> {
    whole: u32,
    fraction: &'a str,
}

impl<'a> DecimalThreshold<'a> {
    fn parse(value: &'a str) -> Option<Self> {
        if value.len() > 4_096 {
            return None;
        }
        let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
        if whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        Some(Self {
            whole: whole.parse().ok()?,
            fraction: fraction.trim_end_matches('0'),
        })
    }

    fn canonical(&self) -> String {
        if self.fraction.is_empty() {
            self.whole.to_string()
        } else {
            format!("{}.{}", self.whole, self.fraction)
        }
    }

    fn rank_sum_limit(&self) -> u32 {
        self.whole * 4
            + if self.fraction >= "75" {
                3
            } else if self.fraction >= "5" {
                2
            } else {
                u32::from(self.fraction >= "25")
            }
    }
}

fn valid_date(value: &str) -> bool {
    let parts = value
        .split('-')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>();
    parts.is_ok_and(|parts| match parts.as_slice() {
        [year, month, day] => {
            value.len() == 10
                && *year > 0
                && (1..=12).contains(month)
                && *day > 0
                && *day <= days_in_month(*year, *month)
        }
        _ => false,
    })
}

fn valid_timestamp(value: &str) -> bool {
    crate::model::valid_timestamp_shape(value)
        && value.get(..10).is_some_and(valid_date)
        && [(11, 13, 23), (14, 16, 59), (17, 19, 59)]
            .into_iter()
            .all(|(start, end, maximum)| {
                value
                    .get(start..end)
                    .and_then(|part| part.parse::<u32>().ok())
                    .is_some_and(|value| value <= maximum)
            })
}

const fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

pub use calculate::{calculate, valid_payload, valid_player};
