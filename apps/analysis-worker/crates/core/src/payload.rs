use std::collections::BTreeSet;

use serde_json::{Map, Value};
use thiserror::Error;

use crate::{
    compute::{ComputedResource, ComputedResourceKind},
    contract::{ResourceManifest, ScopeRef},
};

const AGGREGATE_KEYS: &[&str] = &[
    "schemaVersion",
    "scope",
    "players",
    "summary",
    "metricsByPlayer",
    "rankDistribution",
    "recentRanks",
    "strategyScatter",
    "playOrderComparison",
    "revenueRankConversion",
    "trends",
    "histograms",
    "headToHead",
    "momentumSwitch",
    "performanceProfiles",
    "assetStyleProfiles",
    "cardShopDestination",
    "matchDigest",
    "matchNoInEvent",
    "rankAnalysis",
    "highlights",
    "dataQuality",
    "metricDefinitions",
    "source",
];
const REVIEW_KEYS: &[&str] = &[
    "schemaVersion",
    "scope",
    "baseline",
    "commonPlaybookTopics",
    "playbookByPlayer",
    "dataQuality",
];
const DRILLDOWN_KEYS: &[&str] = &["schemaVersion", "scope", "player", "payload"];
const MATCH_CONTEXT_KEYS: &[&str] = &[
    "schemaVersion",
    "scope",
    "matchId",
    "sourceMatchRevision",
    "match",
];
const PLAYBOOK_CARD_KEYS: &[&str] = &[
    "cardId",
    "classification",
    "category",
    "heading",
    "actionHypothesis",
    "triggerCondition",
    "recommendedAction",
    "avoidAction",
    "dataReason",
    "postMatchCheck",
    "plainReason",
    "evidenceStrength",
    "targetCount",
    "evidence",
    "qualityStatus",
    "stabilityBand",
    "supportCount",
    "anchorTarget",
    "actionAdviceScore",
];
const PLAYBOOK_CATEGORIES: &[&str] = &[
    "revenue",
    "destination",
    "assets",
    "playOrder",
    "ginji",
    "recovery",
    "destinationPositive",
    "accident",
];

#[derive(Debug, Error)]
pub enum PayloadError {
    #[error("resource payload has an unsupported or malformed schema")]
    InvalidSchema,
    #[error("resource payload does not match its manifest identity")]
    IdentityMismatch,
    #[error("resource payload item count does not match its manifest")]
    ItemCountMismatch,
    #[error("resource payload numeric metadata exceeds its schema bound")]
    NumericConversion(#[from] std::num::TryFromIntError),
    #[error("resource payload identity serialization failed")]
    Serialization(#[from] serde_json::Error),
}

/// Validates a freshly computed payload before it reaches artifact staging.
///
/// # Errors
///
/// Returns a bounded contract error when shape, scope, count, or numeric constraints are invalid.
pub fn validate_computed(resource: &ComputedResource) -> Result<(), PayloadError> {
    let item_count = u64::try_from(resource.item_count)?;
    match &resource.kind {
        ComputedResourceKind::Aggregate => {
            validate_aggregate(&resource.payload, &resource.scope, item_count)
        }
        ComputedResourceKind::Review => {
            validate_review(&resource.payload, &resource.scope, item_count)
        }
        ComputedResourceKind::Drilldown {
            member_id,
            metric_id,
        } => validate_drilldown(
            &resource.payload,
            &resource.scope,
            item_count,
            member_id,
            metric_id,
        ),
        ComputedResourceKind::MatchContext { match_id } => validate_match_context(
            &resource.payload,
            &resource.scope,
            item_count,
            match_id,
            &resource
                .source_match_revision
                .ok_or(PayloadError::IdentityMismatch)?
                .to_string(),
        ),
    }
}

/// Validates a staged payload against its manifest identity and count.
///
/// # Errors
///
/// Returns a bounded contract error when the payload does not match its declared resource.
pub fn validate_manifest(resource: &ResourceManifest, payload: &Value) -> Result<(), PayloadError> {
    match resource {
        ResourceManifest::Aggregate { common } => {
            validate_aggregate(payload, &common.scope, common.item_count)
        }
        ResourceManifest::Review { common } => {
            validate_review(payload, &common.scope, common.item_count)
        }
        ResourceManifest::Drilldown {
            common,
            member_id,
            metric_id,
        } => validate_drilldown(
            payload,
            &common.scope,
            common.item_count,
            member_id,
            metric_id,
        ),
        ResourceManifest::MatchContext {
            common,
            match_id,
            source_match_revision,
        } => validate_match_context(
            payload,
            &common.scope,
            common.item_count,
            match_id,
            source_match_revision,
        ),
    }
}

fn validate_aggregate(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
) -> Result<(), PayloadError> {
    let object = exact_object(payload, AGGREGATE_KEYS)?;
    require_schema(object, 2)?;
    validate_scope(object.get("scope"), scope)?;
    let players = array(object.get("players"))?;
    if players.len() > 4 {
        return Err(PayloadError::InvalidSchema);
    }
    let player_ids = players
        .iter()
        .map(|player| {
            exact_object(player, &["memberId"])?
                .get("memberId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or(PayloadError::InvalidSchema)
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    if player_ids.len() != players.len() {
        return Err(PayloadError::InvalidSchema);
    }
    let metrics = array(object.get("metricsByPlayer"))?;
    if metrics.len() != players.len() {
        return Err(PayloadError::InvalidSchema);
    }
    let denominator_sum = metrics.iter().try_fold(0_u64, |sum, metric| {
        let metric = metric.as_object().ok_or(PayloadError::InvalidSchema)?;
        let member_id = metric
            .get("memberId")
            .and_then(Value::as_str)
            .ok_or(PayloadError::InvalidSchema)?;
        if !player_ids.contains(member_id) {
            return Err(PayloadError::IdentityMismatch);
        }
        sum.checked_add(required_u64(metric.get("denominator"))?)
            .ok_or(PayloadError::InvalidSchema)
    })?;
    if denominator_sum != item_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_review(payload: &Value, scope: &ScopeRef, item_count: u64) -> Result<(), PayloadError> {
    let object = exact_object(payload, REVIEW_KEYS)?;
    require_schema(object, 2)?;
    validate_scope(object.get("scope"), scope)?;
    let topics = array(object.get("commonPlaybookTopics"))?;
    if topics.len() > 2 {
        return Err(PayloadError::InvalidSchema);
    }
    for topic in topics {
        let topic = exact_object(
            topic,
            &["topicId", "category", "heading", "detail", "playerIds"],
        )?;
        validate_category(topic.get("category"))?;
        if array(topic.get("playerIds"))?.len() < 3 {
            return Err(PayloadError::InvalidSchema);
        }
    }

    let playbooks = array(object.get("playbookByPlayer"))?;
    if u64::try_from(playbooks.len())? != item_count || playbooks.len() > 4 {
        return Err(PayloadError::ItemCountMismatch);
    }
    let mut members = BTreeSet::new();
    for playbook in playbooks {
        let playbook = exact_object(playbook, &["player", "primaryCard", "secondaryCards"])?;
        let player = exact_object(
            playbook.get("player").ok_or(PayloadError::InvalidSchema)?,
            &["memberId"],
        )?;
        let member_id = player
            .get("memberId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(PayloadError::InvalidSchema)?;
        if !members.insert(member_id) {
            return Err(PayloadError::InvalidSchema);
        }
        let secondary = array(playbook.get("secondaryCards"))?;
        if secondary.len() > 2 {
            return Err(PayloadError::InvalidSchema);
        }
        let mut categories = BTreeSet::new();
        match playbook.get("primaryCard") {
            Some(Value::Null) if secondary.is_empty() => {}
            Some(Value::Null) | None => return Err(PayloadError::InvalidSchema),
            Some(primary) => validate_card(primary, &mut categories)?,
        }
        for card in secondary {
            validate_card(card, &mut categories)?;
        }
    }
    Ok(())
}

fn validate_card<'a>(
    card: &'a Value,
    categories: &mut BTreeSet<&'a str>,
) -> Result<(), PayloadError> {
    let card = exact_object(card, PLAYBOOK_CARD_KEYS)?;
    let classification = card
        .get("classification")
        .and_then(Value::as_str)
        .ok_or(PayloadError::InvalidSchema)?;
    if !matches!(classification, "reproduce" | "revise" | "verify") {
        return Err(PayloadError::InvalidSchema);
    }
    let category = validate_category(card.get("category"))?;
    if !categories.insert(category)
        || required_u64(card.get("targetCount"))? < 3
        || array(card.get("evidence"))?.len() != 2
    {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}

fn validate_category(value: Option<&Value>) -> Result<&str, PayloadError> {
    let category = value
        .and_then(Value::as_str)
        .ok_or(PayloadError::InvalidSchema)?;
    PLAYBOOK_CATEGORIES
        .contains(&category)
        .then_some(category)
        .ok_or(PayloadError::InvalidSchema)
}

fn validate_drilldown(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
    member_id: &str,
    metric_id: &str,
) -> Result<(), PayloadError> {
    let object = exact_object(payload, DRILLDOWN_KEYS)?;
    require_schema(object, 2)?;
    validate_scope(object.get("scope"), scope)?;
    let player = exact_object(
        object.get("player").ok_or(PayloadError::InvalidSchema)?,
        &["memberId"],
    )?;
    if player.get("memberId").and_then(Value::as_str) != Some(member_id) {
        return Err(PayloadError::IdentityMismatch);
    }
    let detail = object
        .get("payload")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let expected_kind = match metric_id {
        "rank.averageHistory" => "rank_average_history",
        "playOrder.rankHistory" => "play_order_rank_history",
        "rankAnalysis.rankSignals" => "rank_signals",
        "rankAnalysis.unexpectedWins" => "unexpected_wins",
        _ => return Err(PayloadError::IdentityMismatch),
    };
    if detail.get("kind").and_then(Value::as_str) != Some(expected_kind) {
        return Err(PayloadError::IdentityMismatch);
    }
    if matches!(
        expected_kind,
        "rank_average_history" | "play_order_rank_history"
    ) {
        let target_count = detail
            .get("summary")
            .and_then(Value::as_object)
            .and_then(|summary| summary.get("targetCount"))
            .map(Some)
            .ok_or(PayloadError::InvalidSchema)?;
        if required_u64(target_count)? != item_count {
            return Err(PayloadError::ItemCountMismatch);
        }
    }
    Ok(())
}

fn validate_match_context(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
    match_id: &str,
    source_match_revision: &str,
) -> Result<(), PayloadError> {
    let object = exact_object(payload, MATCH_CONTEXT_KEYS)?;
    require_schema(object, 1)?;
    validate_scope(object.get("scope"), scope)?;
    if object.get("matchId").and_then(Value::as_str) != Some(match_id)
        || object.get("sourceMatchRevision").and_then(Value::as_str) != Some(source_match_revision)
    {
        return Err(PayloadError::IdentityMismatch);
    }
    let match_value = exact_object(
        object.get("match").ok_or(PayloadError::InvalidSchema)?,
        &[
            "matchIndex",
            "playedAt",
            "players",
            "focusedItemIds",
            "features",
        ],
    )?;
    let players = array(match_value.get("players"))?;
    let focused = array(match_value.get("focusedItemIds"))?;
    let focused_ids = focused
        .iter()
        .map(|item_id| {
            item_id
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or(PayloadError::InvalidSchema)
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    let minimum_focused_count = players.len().saturating_mul(2);
    let maximum_focused_count = players.len().saturating_mul(11).saturating_add(1);
    if players.len() > 4
        || u64::try_from(players.len())? != item_count
        || array(match_value.get("features"))?.len() > 6
        || focused.len() < minimum_focused_count
        || focused.len() > maximum_focused_count
        || focused_ids.len() != focused.len()
    {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_scope(value: Option<&Value>, expected: &ScopeRef) -> Result<(), PayloadError> {
    let scope = value
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let expected_value = serde_json::to_value(expected)?;
    let expected_object = expected_value
        .as_object()
        .ok_or(PayloadError::InvalidSchema)?;
    if scope
        .get("matchCount")
        .is_none_or(|match_count| match_count.as_u64().is_none())
        || scope.len() != expected_object.len() + 1
        || expected_object
            .iter()
            .any(|(key, expected_field)| scope.get(key) != Some(expected_field))
    {
        return Err(PayloadError::IdentityMismatch);
    }
    Ok(())
}

fn require_schema(object: &Map<String, Value>, expected: u64) -> Result<(), PayloadError> {
    (object.get("schemaVersion").and_then(Value::as_u64) == Some(expected))
        .then_some(())
        .ok_or(PayloadError::InvalidSchema)
}

fn exact_object<'a>(
    value: &'a Value,
    expected_keys: &[&str],
) -> Result<&'a Map<String, Value>, PayloadError> {
    let object = value.as_object().ok_or(PayloadError::InvalidSchema)?;
    if object.len() != expected_keys.len()
        || expected_keys.iter().any(|key| !object.contains_key(*key))
    {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(object)
}

fn array(value: Option<&Value>) -> Result<&Vec<Value>, PayloadError> {
    value
        .and_then(Value::as_array)
        .ok_or(PayloadError::InvalidSchema)
}

fn required_u64(value: Option<&Value>) -> Result<u64, PayloadError> {
    value
        .and_then(Value::as_u64)
        .ok_or(PayloadError::InvalidSchema)
}
