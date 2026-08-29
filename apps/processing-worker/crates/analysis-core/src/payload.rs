use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};
use thiserror::Error;

use crate::{
    compute::{ComputedResource, ComputedResourceKind},
    contract::{ResourceManifest, ScopeRef},
};

mod schema;

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
    #[error("resource payload contains an invalid internal reference")]
    ReferenceMismatch,
    #[error("artifact resource set is incomplete or internally inconsistent")]
    ResourceSetMismatch,
}

#[derive(Default)]
pub struct PayloadSetValidator {
    scopes: BTreeMap<ScopeRef, ScopeResources>,
}

#[derive(Default)]
struct ScopeResources {
    aggregate: Option<AggregateReferences>,
    review_members: Option<BTreeSet<String>>,
    drilldowns: BTreeSet<(String, String)>,
    contexts: BTreeMap<String, ContextReferences>,
}

struct AggregateReferences {
    member_ids: BTreeSet<String>,
    item_ids: BTreeSet<String>,
    item_count: u64,
    match_count: u64,
}

struct ContextReferences {
    member_ids: BTreeSet<String>,
    focused_item_ids: BTreeSet<String>,
}

enum ResourceReferences {
    Aggregate(AggregateReferences),
    Review(BTreeSet<String>),
    Drilldown {
        member_id: String,
        metric_id: String,
    },
    MatchContext {
        match_id: String,
        context: ContextReferences,
    },
}

impl PayloadSetValidator {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Validates and records a freshly computed resource for whole-artifact reference checks.
    ///
    /// # Errors
    ///
    /// Returns an error when the resource is malformed or duplicates an identity in this set.
    pub fn add_computed(&mut self, resource: &ComputedResource) -> Result<(), PayloadError> {
        let references = validate_computed_resource(resource)?;
        self.record(resource.scope.clone(), references)
    }

    /// Validates and records a re-opened manifest resource for whole-artifact reference checks.
    ///
    /// # Errors
    ///
    /// Returns an error when the resource is malformed or duplicates an identity in this set.
    pub fn add_manifest(
        &mut self,
        resource: &ResourceManifest,
        payload: &Value,
    ) -> Result<(), PayloadError> {
        let references = validate_manifest_resource(resource, payload)?;
        self.record(resource_scope(resource).clone(), references)
    }

    /// Closes the artifact validation session and checks all cross-resource references.
    ///
    /// # Errors
    ///
    /// Returns an error when a scope is incomplete or a context points outside its aggregate.
    pub fn finish(self) -> Result<(), PayloadError> {
        for resources in self.scopes.into_values() {
            let aggregate = resources
                .aggregate
                .ok_or(PayloadError::ResourceSetMismatch)?;
            let review_members = resources
                .review_members
                .ok_or(PayloadError::ResourceSetMismatch)?;
            if review_members != aggregate.member_ids {
                return Err(PayloadError::ReferenceMismatch);
            }
            let expected_drilldowns = aggregate
                .member_ids
                .iter()
                .flat_map(|member_id| {
                    DRILLDOWN_METRIC_IDS
                        .iter()
                        .map(move |metric_id| (member_id.clone(), String::from(*metric_id)))
                })
                .collect::<BTreeSet<_>>();
            if resources.drilldowns != expected_drilldowns
                || u64::try_from(resources.contexts.len())? != aggregate.match_count
            {
                return Err(PayloadError::ResourceSetMismatch);
            }
            let context_item_count = resources
                .contexts
                .values()
                .try_fold(0_u64, |total, context| {
                    total.checked_add(u64::try_from(context.member_ids.len()).ok()?)
                });
            if context_item_count != Some(aggregate.item_count) {
                return Err(PayloadError::ResourceSetMismatch);
            }
            for context in resources.contexts.into_values() {
                if !context.member_ids.is_subset(&aggregate.member_ids)
                    || !context.focused_item_ids.is_subset(&aggregate.item_ids)
                {
                    return Err(PayloadError::ReferenceMismatch);
                }
            }
        }
        Ok(())
    }

    fn record(
        &mut self,
        scope: ScopeRef,
        references: ResourceReferences,
    ) -> Result<(), PayloadError> {
        let scope = self.scopes.entry(scope).or_default();
        let inserted = match references {
            ResourceReferences::Aggregate(references) => {
                scope.aggregate.replace(references).is_none()
            }
            ResourceReferences::Review(member_ids) => {
                scope.review_members.replace(member_ids).is_none()
            }
            ResourceReferences::Drilldown {
                member_id,
                metric_id,
            } => scope.drilldowns.insert((member_id, metric_id)),
            ResourceReferences::MatchContext { match_id, context } => {
                scope.contexts.insert(match_id, context).is_none()
            }
        };
        inserted
            .then_some(())
            .ok_or(PayloadError::ResourceSetMismatch)
    }
}

const DRILLDOWN_METRIC_IDS: &[&str] = &[
    "rank.averageHistory",
    "playOrder.rankHistory",
    "rankAnalysis.rankSignals",
    "rankAnalysis.unexpectedWins",
];

/// Validates a freshly computed payload before it reaches artifact staging.
///
/// # Errors
///
/// Returns a bounded contract error when shape, scope, count, or numeric constraints are invalid.
pub fn validate_computed(resource: &ComputedResource) -> Result<(), PayloadError> {
    validate_computed_resource(resource).map(|_| ())
}

fn validate_computed_resource(
    resource: &ComputedResource,
) -> Result<ResourceReferences, PayloadError> {
    let item_count = u64::try_from(resource.item_count)?;
    match &resource.kind {
        ComputedResourceKind::Aggregate => {
            validate_aggregate(&resource.payload, &resource.scope, item_count)
        }
        ComputedResourceKind::Review => {
            validate_review(&resource.payload, &resource.scope, item_count)
        }
        ComputedResourceKind::Drilldown { member_id, metric } => validate_drilldown(
            &resource.payload,
            &resource.scope,
            item_count,
            member_id,
            metric.wire(),
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
    validate_manifest_resource(resource, payload).map(|_| ())
}

fn validate_manifest_resource(
    resource: &ResourceManifest,
    payload: &Value,
) -> Result<ResourceReferences, PayloadError> {
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

const fn resource_scope(resource: &ResourceManifest) -> &ScopeRef {
    match resource {
        ResourceManifest::Aggregate { common }
        | ResourceManifest::Review { common }
        | ResourceManifest::Drilldown { common, .. }
        | ResourceManifest::MatchContext { common, .. } => &common.scope,
    }
}

fn validate_aggregate(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
) -> Result<ResourceReferences, PayloadError> {
    schema::validate_aggregate(payload)?;
    let object = payload.as_object().ok_or(PayloadError::InvalidSchema)?;
    validate_scope(object.get("scope"), scope)?;
    let players = array(object.get("players"))?;
    let player_order = member_id_order(players)?;
    let player_ids = player_order.iter().copied().collect::<BTreeSet<_>>();
    if player_ids.len() != players.len() {
        return Err(PayloadError::InvalidSchema);
    }
    let metrics = array(object.get("metricsByPlayer"))?;
    if metrics.len() != players.len() {
        return Err(PayloadError::InvalidSchema);
    }
    let denominator_sum = metrics.iter().try_fold(0_u64, |sum, metric| {
        let metric = metric.as_object().ok_or(PayloadError::InvalidSchema)?;
        let member_id = required_string(metric.get("memberId"))?;
        if !player_ids.contains(member_id) {
            return Err(PayloadError::IdentityMismatch);
        }
        sum.checked_add(required_u64(metric.get("denominator"))?)
            .ok_or(PayloadError::InvalidSchema)
    })?;
    if denominator_sum != item_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    validate_aggregate_semantics(object, &player_ids, &player_order, item_count)?;
    let item_ids = collect_unique_item_ids(payload)?;
    validate_member_references(payload, &player_ids)?;
    Ok(ResourceReferences::Aggregate(AggregateReferences {
        member_ids: player_ids.into_iter().map(String::from).collect(),
        item_ids,
        item_count,
        match_count: required_u64(
            object
                .get("scope")
                .and_then(Value::as_object)
                .and_then(|scope_value| scope_value.get("matchCount")),
        )?,
    }))
}

fn validate_review(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
) -> Result<ResourceReferences, PayloadError> {
    schema::validate_review(payload)?;
    let object = payload.as_object().ok_or(PayloadError::InvalidSchema)?;
    validate_scope(object.get("scope"), scope)?;
    let topics = array(object.get("commonPlaybookTopics"))?;
    for topic in topics {
        if topic
            .get("playerIds")
            .and_then(Value::as_array)
            .is_none_or(|player_ids| player_ids.len() < 3)
        {
            return Err(PayloadError::InvalidSchema);
        }
    }

    let playbooks = array(object.get("playbookByPlayer"))?;
    if u64::try_from(playbooks.len())? != item_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    let mut members = BTreeSet::new();
    for playbook in playbooks {
        let playbook = playbook.as_object().ok_or(PayloadError::InvalidSchema)?;
        let player = playbook
            .get("player")
            .and_then(Value::as_object)
            .ok_or(PayloadError::InvalidSchema)?;
        let member_id = required_string(player.get("memberId"))?;
        if !members.insert(member_id) {
            return Err(PayloadError::InvalidSchema);
        }
        let secondary = array(playbook.get("secondaryCards"))?;
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
    let baseline = object
        .get("baseline")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let scope_match_count = object
        .get("scope")
        .and_then(Value::as_object)
        .and_then(|scope_value| scope_value.get("matchCount"));
    if required_u64(baseline.get("playerCount"))? != item_count
        || baseline.get("matchCount") != scope_match_count
    {
        return Err(PayloadError::ItemCountMismatch);
    }
    validate_member_references(payload, &members)?;
    collect_unique_ids(topics, "topicId")?;
    collect_unique_item_ids(payload)?;
    Ok(ResourceReferences::Review(
        members.into_iter().map(String::from).collect(),
    ))
}

fn validate_card<'a>(
    card: &'a Value,
    categories: &mut BTreeSet<&'a str>,
) -> Result<(), PayloadError> {
    let card = card.as_object().ok_or(PayloadError::InvalidSchema)?;
    let category = required_string(card.get("category"))?;
    if !categories.insert(category) || required_u64(card.get("targetCount"))? < 3 {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}

fn validate_drilldown(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
    member_id: &str,
    metric_id: &str,
) -> Result<ResourceReferences, PayloadError> {
    schema::validate_drilldown(payload, metric_id)?;
    let object = payload.as_object().ok_or(PayloadError::InvalidSchema)?;
    validate_scope(object.get("scope"), scope)?;
    let player_value = object.get("player").ok_or(PayloadError::InvalidSchema)?;
    let player = player_value
        .as_object()
        .ok_or(PayloadError::InvalidSchema)?;
    if player.get("memberId").and_then(Value::as_str) != Some(member_id) {
        return Err(PayloadError::IdentityMismatch);
    }
    let detail_value = object.get("payload").ok_or(PayloadError::InvalidSchema)?;
    let detail = detail_value
        .as_object()
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
    validate_drilldown_semantics(detail, expected_kind, item_count)?;
    let allowed = BTreeSet::from([member_id]);
    validate_member_references(payload, &allowed)?;
    collect_unique_item_ids(payload)?;
    Ok(ResourceReferences::Drilldown {
        member_id: String::from(member_id),
        metric_id: String::from(metric_id),
    })
}

fn validate_match_context(
    payload: &Value,
    scope: &ScopeRef,
    item_count: u64,
    match_id: &str,
    source_match_revision: &str,
) -> Result<ResourceReferences, PayloadError> {
    schema::validate_match_context(payload)?;
    let object = payload.as_object().ok_or(PayloadError::InvalidSchema)?;
    validate_scope(object.get("scope"), scope)?;
    if object.get("matchId").and_then(Value::as_str) != Some(match_id)
        || object.get("sourceMatchRevision").and_then(Value::as_str) != Some(source_match_revision)
    {
        return Err(PayloadError::IdentityMismatch);
    }
    let match_payload = object.get("match").ok_or(PayloadError::InvalidSchema)?;
    let match_value = match_payload
        .as_object()
        .ok_or(PayloadError::InvalidSchema)?;
    let players = array(match_value.get("players"))?;
    let player_ids = players
        .iter()
        .map(|player| {
            player
                .as_object()
                .and_then(|player| player.get("memberId"))
                .and_then(Value::as_str)
                .ok_or(PayloadError::InvalidSchema)
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
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
    let maximum_focused_count = players.len().saturating_mul(12).saturating_add(1);
    if players.len() > 4
        || player_ids.len() != players.len()
        || u64::try_from(players.len())? != item_count
        || array(match_value.get("features"))?.len() > 6
        || focused.len() < minimum_focused_count
        || focused.len() > maximum_focused_count
        || focused_ids.len() != focused.len()
    {
        return Err(PayloadError::ItemCountMismatch);
    }
    let ranks = players
        .iter()
        .filter_map(|player| player.get("rank").and_then(Value::as_u64))
        .collect::<BTreeSet<_>>();
    if ranks.len() != players.len() || required_u64(match_value.get("matchIndex"))? == 0 {
        return Err(PayloadError::InvalidSchema);
    }
    validate_member_references(payload, &player_ids)?;
    collect_unique_ids(array(match_value.get("features"))?, "featureCode")?;
    Ok(ResourceReferences::MatchContext {
        match_id: String::from(match_id),
        context: ContextReferences {
            member_ids: player_ids.into_iter().map(String::from).collect(),
            focused_item_ids: focused_ids.into_iter().map(String::from).collect(),
        },
    })
}

fn validate_aggregate_semantics(
    object: &Map<String, Value>,
    player_ids: &BTreeSet<&str>,
    player_order: &[&str],
    item_count: u64,
) -> Result<(), PayloadError> {
    validate_aggregate_member_sections(object, player_ids)?;
    validate_aggregate_metrics(object)?;

    for distribution in array(object.get("rankDistribution"))? {
        let distribution = distribution
            .as_object()
            .ok_or(PayloadError::InvalidSchema)?;
        validate_rank_cells(
            array(distribution.get("cells"))?,
            required_u64(distribution.get("total"))?,
        )?;
    }
    for recent in array(object.get("recentRanks"))? {
        let recent = recent.as_object().ok_or(PayloadError::InvalidSchema)?;
        let rows = array(recent.get("rows"))?;
        if required_u64(recent.get("windowSize"))? != 20
            || required_u64(recent.get("targetCount"))? != u64::try_from(rows.len())?
        {
            return Err(PayloadError::ItemCountMismatch);
        }
    }
    let strategy_points = object
        .get("strategyScatter")
        .and_then(Value::as_object)
        .and_then(|scatter| scatter.get("points"))
        .and_then(Value::as_array)
        .ok_or(PayloadError::InvalidSchema)?;
    if u64::try_from(strategy_points.len())? != item_count {
        return Err(PayloadError::ItemCountMismatch);
    }

    for comparison in array(object.get("playOrderComparison"))? {
        let cells = comparison
            .get("cells")
            .and_then(Value::as_array)
            .ok_or(PayloadError::InvalidSchema)?;
        validate_numbered_rows(cells, "playOrder", 4)?;
    }
    for conversion in array(object.get("revenueRankConversion"))? {
        let cells = conversion
            .get("cells")
            .and_then(Value::as_array)
            .ok_or(PayloadError::InvalidSchema)?;
        if cells.len() != 16 {
            return Err(PayloadError::InvalidSchema);
        }
        let pairs = cells
            .iter()
            .filter_map(|cell| {
                Some((
                    cell.get("revenueRank")?.as_u64()?,
                    cell.get("finalRank")?.as_u64()?,
                ))
            })
            .collect::<BTreeSet<_>>();
        if pairs.len() != 16 {
            return Err(PayloadError::InvalidSchema);
        }
    }

    validate_trends(object.get("trends"), player_ids)?;
    validate_histograms(object.get("histograms"), player_ids)?;
    validate_head_to_head(object.get("headToHead"), player_ids)?;
    validate_momentum(object.get("momentumSwitch"))?;
    validate_card_shop(object.get("cardShopDestination"))?;
    validate_match_digest(object)?;
    validate_match_number_entries(object.get("matchNoInEvent"), player_order)?;
    validate_rank_analysis(object.get("rankAnalysis"), player_ids)?;
    validate_data_quality(object.get("dataQuality"), player_ids)?;
    collect_unique_ids(array(object.get("metricDefinitions"))?, "metricId")?;
    collect_unique_ids(array(object.get("highlights"))?, "highlightId")?;
    Ok(())
}

fn validate_aggregate_member_sections(
    object: &Map<String, Value>,
    player_ids: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    for key in [
        "metricsByPlayer",
        "rankDistribution",
        "recentRanks",
        "playOrderComparison",
        "revenueRankConversion",
        "momentumSwitch",
        "cardShopDestination",
    ] {
        validate_exact_member_entries(array(object.get(key))?, player_ids)?;
    }
    for (key, nested_key) in [
        ("performanceProfiles", "entries"),
        ("assetStyleProfiles", "entries"),
    ] {
        let nested = object
            .get(key)
            .and_then(Value::as_object)
            .ok_or(PayloadError::InvalidSchema)?;
        validate_exact_member_entries(array(nested.get(nested_key))?, player_ids)?;
    }
    Ok(())
}

fn validate_aggregate_metrics(object: &Map<String, Value>) -> Result<(), PayloadError> {
    let metrics = array(object.get("metricsByPlayer"))?;
    for metric in metrics {
        let metric = metric.as_object().ok_or(PayloadError::InvalidSchema)?;
        let denominator = required_u64(metric.get("denominator"))?;
        let rank = metric
            .get("rank")
            .and_then(Value::as_object)
            .ok_or(PayloadError::InvalidSchema)?;
        validate_rank_cells(array(rank.get("distribution"))?, denominator)?;
        let play_order = metric
            .get("playOrder")
            .and_then(Value::as_object)
            .ok_or(PayloadError::InvalidSchema)?;
        let breakdown = array(play_order.get("breakdown"))?;
        validate_numbered_rows(breakdown, "playOrder", 4)?;
        if sum_field(breakdown, "matchCount")? != denominator {
            return Err(PayloadError::ItemCountMismatch);
        }
        for outcome_key in ["revenueOutcome", "destinationOutcome"] {
            let outcomes = metric
                .get(outcome_key)
                .and_then(Value::as_object)
                .ok_or(PayloadError::InvalidSchema)?;
            for outcome in outcomes.values().filter_map(Value::as_object) {
                if outcome.contains_key("rankDistribution") {
                    let target_count = required_u64(outcome.get("targetCount"))?;
                    validate_rank_cells(array(outcome.get("rankDistribution"))?, target_count)?;
                    validate_outcome_counts(outcome, target_count)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_outcome_counts(
    outcome: &Map<String, Value>,
    target_count: u64,
) -> Result<(), PayloadError> {
    for key in ["winCount", "podiumCount", "lowerHalfCount"] {
        if required_u64(outcome.get(key))? > target_count {
            return Err(PayloadError::ItemCountMismatch);
        }
    }
    Ok(())
}

fn validate_rank_cells(cells: &[Value], expected_total: u64) -> Result<(), PayloadError> {
    validate_numbered_rows(cells, "rank", 4)?;
    if sum_field(cells, "count")? != expected_total {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_numbered_rows(
    rows: &[Value],
    field: &str,
    expected_count: usize,
) -> Result<(), PayloadError> {
    let numbers = rows
        .iter()
        .filter_map(|row| row.get(field).and_then(Value::as_u64))
        .collect::<BTreeSet<_>>();
    let expected = (1..=expected_count)
        .map(u64::try_from)
        .collect::<Result<BTreeSet<_>, _>>()?;
    if rows.len() != expected_count || numbers != expected {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}

fn sum_field(rows: &[Value], field: &str) -> Result<u64, PayloadError> {
    rows.iter().try_fold(0_u64, |total, row| {
        total
            .checked_add(required_u64(row.get(field))?)
            .ok_or(PayloadError::InvalidSchema)
    })
}

fn validate_trends(value: Option<&Value>, player_ids: &BTreeSet<&str>) -> Result<(), PayloadError> {
    let trends = array(value)?;
    let identities = trends
        .iter()
        .filter_map(|trend| {
            Some((
                trend.get("memberId")?.as_str()?,
                trend.get("kind")?.as_str()?,
            ))
        })
        .collect::<BTreeSet<_>>();
    if trends.len() != player_ids.len().saturating_mul(5)
        || identities.len() != trends.len()
        || identities
            .iter()
            .any(|(member_id, _)| !player_ids.contains(member_id))
    {
        return Err(PayloadError::ReferenceMismatch);
    }
    Ok(())
}

fn validate_histograms(
    value: Option<&Value>,
    player_ids: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    let histograms = value
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    for histogram in histograms.values() {
        let histogram = histogram.as_object().ok_or(PayloadError::InvalidSchema)?;
        let bins = array(histogram.get("bins"))?;
        let series = array(histogram.get("series"))?;
        validate_exact_member_entries(series, player_ids)?;
        for entry in series {
            if entry
                .get("counts")
                .and_then(Value::as_array)
                .is_none_or(|counts| counts.len() != bins.len())
            {
                return Err(PayloadError::ItemCountMismatch);
            }
        }
    }
    Ok(())
}

fn validate_head_to_head(
    value: Option<&Value>,
    player_ids: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    let entries = value
        .and_then(Value::as_object)
        .and_then(|head| head.get("entries"))
        .and_then(Value::as_array)
        .ok_or(PayloadError::InvalidSchema)?;
    let pairs = entries
        .iter()
        .filter_map(|entry| {
            Some((
                entry.get("subjectMemberId")?.as_str()?,
                entry.get("opponentMemberId")?.as_str()?,
            ))
        })
        .collect::<BTreeSet<_>>();
    let expected_count = player_ids.len().saturating_mul(player_ids.len());
    if entries.len() != expected_count || pairs.len() != expected_count {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_momentum(value: Option<&Value>) -> Result<(), PayloadError> {
    for momentum in array(value)? {
        let cells = momentum
            .get("cells")
            .and_then(Value::as_array)
            .ok_or(PayloadError::InvalidSchema)?;
        let pairs = cells
            .iter()
            .filter_map(|cell| {
                Some((
                    cell.get("previousRank")?.as_u64()?,
                    cell.get("nextRank")?.as_u64()?,
                ))
            })
            .collect::<BTreeSet<_>>();
        if cells.len() != 16 || pairs.len() != 16 {
            return Err(PayloadError::InvalidSchema);
        }
    }
    Ok(())
}

fn validate_card_shop(value: Option<&Value>) -> Result<(), PayloadError> {
    for entry in array(value)? {
        let quadrants = entry
            .get("quadrants")
            .and_then(Value::as_array)
            .ok_or(PayloadError::InvalidSchema)?;
        let kinds = quadrants
            .iter()
            .filter_map(|quadrant| quadrant.get("kind").and_then(Value::as_str))
            .collect::<BTreeSet<_>>();
        if quadrants.len() != 4 || kinds.len() != 4 {
            return Err(PayloadError::InvalidSchema);
        }
    }
    Ok(())
}

fn validate_match_digest(object: &Map<String, Value>) -> Result<(), PayloadError> {
    let scope_match_count = object
        .get("scope")
        .and_then(Value::as_object)
        .and_then(|scope| scope.get("matchCount"));
    let digest = object
        .get("matchDigest")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let total = required_u64(digest.get("totalCount"))?;
    let shown = required_u64(digest.get("shownCount"))?;
    let hidden = required_u64(digest.get("hiddenCount"))?;
    if Some(
        digest
            .get("totalCount")
            .ok_or(PayloadError::InvalidSchema)?,
    ) != scope_match_count
        || shown.checked_add(hidden) != Some(total)
        || u64::try_from(array(digest.get("recent"))?.len())? != shown
    {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_match_number_entries(
    value: Option<&Value>,
    player_order: &[&str],
) -> Result<(), PayloadError> {
    let entries = value
        .and_then(Value::as_object)
        .and_then(|value| value.get("entries"))
        .and_then(Value::as_array)
        .ok_or(PayloadError::InvalidSchema)?;
    let mut previous_number = None;
    for entry in entries {
        let number = entry
            .get("matchNoInEvent")
            .and_then(Value::as_i64)
            .ok_or(PayloadError::InvalidSchema)?;
        if number <= 0 || previous_number.is_some_and(|previous| previous >= number) {
            return Err(PayloadError::InvalidSchema);
        }
        previous_number = Some(number);

        let expected_category = if number <= 4 { "regular" } else { "additional" };
        if required_string(entry.get("category"))? != expected_category {
            return Err(PayloadError::InvalidSchema);
        }

        let actual_player_order = array(entry.get("players"))?
            .iter()
            .map(|player| required_string(player.get("memberId")))
            .collect::<Result<Vec<_>, _>>()?;
        if actual_player_order != player_order {
            return Err(PayloadError::ReferenceMismatch);
        }
    }
    Ok(())
}

fn validate_rank_analysis(
    value: Option<&Value>,
    player_ids: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    let analysis = value
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    validate_exact_member_entries(array(analysis.get("rankSignalsByPlayer"))?, player_ids)?;
    validate_exact_member_entries(array(analysis.get("unexpectedWinsByPlayer"))?, player_ids)?;
    let crown = analysis
        .get("crownCertainty")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let shares = array(crown.get("shares"))?;
    if !shares.is_empty() {
        validate_exact_member_entries(shares, player_ids)?;
    }
    Ok(())
}

fn validate_data_quality(
    value: Option<&Value>,
    player_ids: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    let quality = value
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let items = array(quality.get("items"))?;
    let identities = items
        .iter()
        .filter_map(|item| {
            Some((
                item.get("memberId")?.as_str()?,
                item.get("metricId")?.as_str()?,
            ))
        })
        .collect::<BTreeSet<_>>();
    if items.len() != player_ids.len().saturating_mul(8)
        || identities.len() != items.len()
        || identities
            .iter()
            .any(|(member_id, _)| !player_ids.contains(member_id))
    {
        return Err(PayloadError::ReferenceMismatch);
    }
    let summary = quality
        .get("summary")
        .and_then(Value::as_object)
        .ok_or(PayloadError::InvalidSchema)?;
    let status_count = ["okCount", "referenceCount", "noTargetCount"]
        .into_iter()
        .try_fold(0_u64, |total, key| {
            total
                .checked_add(required_u64(summary.get(key))?)
                .ok_or(PayloadError::InvalidSchema)
        })?;
    if status_count != u64::try_from(items.len())? {
        return Err(PayloadError::ItemCountMismatch);
    }
    Ok(())
}

fn validate_drilldown_semantics(
    detail: &Map<String, Value>,
    kind: &str,
    item_count: u64,
) -> Result<(), PayloadError> {
    match kind {
        "rank_average_history" => {
            let rows = array(detail.get("matchRows"))?;
            if u64::try_from(rows.len())? != item_count {
                return Err(PayloadError::ItemCountMismatch);
            }
            let event_rows = array(detail.get("eventRows"))?;
            if sum_field(event_rows, "matchCount")? != item_count {
                return Err(PayloadError::ItemCountMismatch);
            }
        }
        "play_order_rank_history" => {
            let series = array(detail.get("seriesByPlayOrder"))?;
            let rows = array(detail.get("rows"))?;
            if u64::try_from(series.len())? != item_count
                || sum_field(rows, "targetCount")? != item_count
            {
                return Err(PayloadError::ItemCountMismatch);
            }
            validate_numbered_rows(rows, "playOrder", 4)?;
            for row in rows {
                validate_rank_cells(
                    array(row.get("rankDistribution"))?,
                    required_u64(row.get("targetCount"))?,
                )?;
            }
            let summary = detail
                .get("summary")
                .and_then(Value::as_object)
                .ok_or(PayloadError::InvalidSchema)?;
            let counts = array(summary.get("countsByPlayOrder"))?;
            validate_numbered_rows(counts, "playOrder", 4)?;
            if sum_field(counts, "matchCount")? != item_count {
                return Err(PayloadError::ItemCountMismatch);
            }
        }
        "rank_signals" => {
            let candidates = array(detail.get("candidates"))?;
            collect_unique_ids(candidates, "signal")?;
            for candidate in candidates {
                if array(candidate.get("foldRows"))?.len() != 5 {
                    return Err(PayloadError::ItemCountMismatch);
                }
            }
        }
        "unexpected_wins" => {
            let summary = detail
                .get("summary")
                .and_then(Value::as_object)
                .ok_or(PayloadError::InvalidSchema)?;
            let rows = array(detail.get("rows"))?;
            if required_u64(summary.get("unexpectedWinCount"))? != u64::try_from(rows.len())?
                || required_u64(summary.get("totalWinCount"))? < u64::try_from(rows.len())?
            {
                return Err(PayloadError::ItemCountMismatch);
            }
        }
        _ => return Err(PayloadError::IdentityMismatch),
    }
    Ok(())
}

fn validate_exact_member_entries(
    values: &[Value],
    expected: &BTreeSet<&str>,
) -> Result<(), PayloadError> {
    let actual = values
        .iter()
        .filter_map(|entry| entry.get("memberId").and_then(Value::as_str))
        .collect::<BTreeSet<_>>();
    if values.len() != expected.len() || actual != *expected {
        return Err(PayloadError::ReferenceMismatch);
    }
    Ok(())
}

fn member_id_order(players: &[Value]) -> Result<Vec<&str>, PayloadError> {
    players
        .iter()
        .map(|player| required_string(player.get("memberId")))
        .collect()
}

fn validate_member_references(value: &Value, allowed: &BTreeSet<&str>) -> Result<(), PayloadError> {
    match value {
        Value::Array(values) => values
            .iter()
            .try_for_each(|entry| validate_member_references(entry, allowed)),
        Value::Object(object) => {
            for (key, field) in object {
                if matches!(
                    key.as_str(),
                    "memberId"
                        | "subjectMemberId"
                        | "opponentMemberId"
                        | "winnerMemberId"
                        | "defaultMemberId"
                ) {
                    if !field.is_null()
                        && field
                            .as_str()
                            .is_none_or(|member_id| !allowed.contains(member_id))
                    {
                        return Err(PayloadError::ReferenceMismatch);
                    }
                } else if matches!(
                    key.as_str(),
                    "memberIds" | "playerIds" | "leaderMemberIds" | "revenueTopMemberIds"
                ) {
                    let references = field.as_array().ok_or(PayloadError::InvalidSchema)?;
                    let unique = references
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<BTreeSet<_>>();
                    if unique.len() != references.len()
                        || unique.iter().any(|member_id| !allowed.contains(member_id))
                    {
                        return Err(PayloadError::ReferenceMismatch);
                    }
                }
                validate_member_references(field, allowed)?;
            }
            Ok(())
        }
        Value::Bool(_) | Value::Null | Value::Number(_) | Value::String(_) => Ok(()),
    }
}

fn collect_unique_item_ids(value: &Value) -> Result<BTreeSet<String>, PayloadError> {
    fn collect(value: &Value, result: &mut BTreeSet<String>) -> Result<(), PayloadError> {
        match value {
            Value::Array(values) => values.iter().try_for_each(|entry| collect(entry, result)),
            Value::Object(object) => {
                if let Some(item_id) = object.get("itemId") {
                    let item_id = required_string(Some(item_id))?;
                    if !result.insert(String::from(item_id)) {
                        return Err(PayloadError::ReferenceMismatch);
                    }
                }
                object.values().try_for_each(|entry| collect(entry, result))
            }
            Value::Bool(_) | Value::Null | Value::Number(_) | Value::String(_) => Ok(()),
        }
    }

    let mut result = BTreeSet::new();
    collect(value, &mut result)?;
    Ok(result)
}

fn collect_unique_ids(values: &[Value], field: &str) -> Result<(), PayloadError> {
    let identifiers = values
        .iter()
        .filter_map(|entry| entry.get(field).and_then(Value::as_str))
        .collect::<BTreeSet<_>>();
    if identifiers.len() != values.len() {
        return Err(PayloadError::InvalidSchema);
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

fn required_string(value: Option<&Value>) -> Result<&str, PayloadError> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(PayloadError::InvalidSchema)
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "payload mutation fixtures must abort when an expected path is absent"
)]
mod tests {
    use super::*;
    use crate::{
        compute::{DrilldownMetric, compute_all},
        model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
    };

    fn fixture(contents: &str) -> Result<Value, serde_json::Error> {
        serde_json::from_str(contents)
    }

    fn input(match_count: i32) -> AnalysisInput {
        AnalysisInput {
            game_title_id: String::from("title-payload"),
            input_revision: 1,
            player_matches: (1..=match_count)
                .flat_map(|match_index| {
                    (1..=4).map(move |player| PlayerMatchInput {
                        match_id: format!("match-{match_index}"),
                        match_revision: 1,
                        played_at: format!(
                            "2026-{:02}-{:02}T00:00:00.000000Z",
                            (match_index - 1) / 28 + 1,
                            (match_index - 1).rem_euclid(28) + 1,
                        ),
                        held_event_id: format!("event-{}", (match_index - 1) / 4 + 1),
                        match_no_in_event: (match_index - 1).rem_euclid(4) + 1,
                        season_master_id: String::from("season-1"),
                        map_master_id: String::from("map-1"),
                        member_id: format!("member-{player}"),
                        play_order: player,
                        rank: (player + match_index - 2).rem_euclid(4) + 1,
                        total_assets_man_yen: player * 1_000 + match_index,
                        revenue_man_yen: (5 - player) * 100 + match_index,
                        incidents: IncidentCounts {
                            destination: (player + match_index).rem_euclid(3),
                            plus_station: player,
                            minus_station: match_index.rem_euclid(2),
                            card_station: player.rem_euclid(2),
                            card_shop: (player + match_index).rem_euclid(2),
                            suri_no_ginji: i32::from(player == 4),
                        },
                    })
                })
                .collect(),
        }
    }

    fn overall_resource(
        resources: &[ComputedResource],
        kind: &ComputedResourceKind,
    ) -> ComputedResource {
        resources
            .iter()
            .find(|resource| resource.scope == ScopeRef::Overall && &resource.kind == kind)
            .cloned()
            .unwrap_or_else(|| panic!("overall resource missing: {kind:?}"))
    }

    fn remove_field(resource: &mut ComputedResource, pointer: &str, field: &str) {
        resource
            .payload
            .pointer_mut(pointer)
            .and_then(Value::as_object_mut)
            .and_then(|object| object.remove(field))
            .unwrap_or_else(|| panic!("mutation field missing: {pointer}/{field}"));
    }

    #[test]
    fn shared_v3_payload_fixtures_match_worker_contract() {
        let aggregate = fixture(include_str!(concat!(
            "../../../../../docs/schemas/fixtures/series-analysis/",
            "aggregate-payload-v3.json"
        )));
        let review = fixture(include_str!(concat!(
            "../../../../../docs/schemas/fixtures/series-analysis/",
            "review-payload-v3.json"
        )));
        let drilldown = fixture(include_str!(concat!(
            "../../../../../docs/schemas/fixtures/series-analysis/",
            "drilldown-payload-v3.json"
        )));
        assert!(aggregate.is_ok() && review.is_ok() && drilldown.is_ok());
        let (Some(aggregate), Some(review), Some(drilldown)) =
            (aggregate.ok(), review.ok(), drilldown.ok())
        else {
            return;
        };

        assert!(validate_aggregate(&aggregate, &ScopeRef::Overall, 0).is_ok());
        assert!(validate_review(&review, &ScopeRef::Overall, 1).is_ok());
        assert!(
            validate_drilldown(
                &drilldown,
                &ScopeRef::Overall,
                1,
                "member-1",
                "rank.averageHistory"
            )
            .is_ok()
        );
    }

    #[test]
    fn complete_computed_resource_set_passes_the_shared_validator() {
        for match_count in [0, 32] {
            let resources = compute_all(&input(match_count));
            let mut validator = PayloadSetValidator::new();
            for resource in &resources {
                let result = validator.add_computed(resource);
                assert!(
                    result.is_ok(),
                    "computed payload failed for {match_count} matches: {:?}: {:?}\n{}",
                    resource.kind,
                    result.err(),
                    resource.payload,
                );
            }
            assert!(validator.finish().is_ok());
        }
    }

    #[test]
    fn aggregate_nested_shape_type_enum_and_reference_mutations_are_rejected() {
        let resources = compute_all(&input(2));
        let kind = ComputedResourceKind::Aggregate;

        let mut unknown = overall_resource(&resources, &kind);
        unknown
            .payload
            .pointer_mut("/metricsByPlayer/0/rank")
            .and_then(Value::as_object_mut)
            .unwrap_or_else(|| panic!("rank metrics"))
            .insert(String::from("unexpected"), Value::Bool(true));
        assert!(matches!(
            validate_computed(&unknown),
            Err(PayloadError::InvalidSchema)
        ));

        let mut wrong_type = overall_resource(&resources, &kind);
        *wrong_type
            .payload
            .pointer_mut("/rankDistribution/0/cells/0/count")
            .unwrap_or_else(|| panic!("rank count")) = Value::String(String::from("1"));
        assert!(matches!(
            validate_computed(&wrong_type),
            Err(PayloadError::InvalidSchema)
        ));

        let mut wrong_enum = overall_resource(&resources, &kind);
        *wrong_enum
            .payload
            .pointer_mut("/metricsByPlayer/0/qualityStatus")
            .unwrap_or_else(|| panic!("quality status")) = Value::String(String::from("unknown"));
        assert!(matches!(
            validate_computed(&wrong_enum),
            Err(PayloadError::InvalidSchema)
        ));

        let mut wrong_reference = overall_resource(&resources, &kind);
        *wrong_reference
            .payload
            .pointer_mut("/summary/leaderMemberIds/0")
            .unwrap_or_else(|| panic!("leader member")) =
            Value::String(String::from("member-unknown"));
        assert!(matches!(
            validate_computed(&wrong_reference),
            Err(PayloadError::ReferenceMismatch)
        ));

        let mut duplicate_item = overall_resource(&resources, &kind);
        let first_item = duplicate_item
            .payload
            .pointer("/rankDistribution/0/cells/0/itemId")
            .cloned()
            .unwrap_or_else(|| panic!("first item id"));
        *duplicate_item
            .payload
            .pointer_mut("/rankDistribution/0/cells/1/itemId")
            .unwrap_or_else(|| panic!("second item id")) = first_item;
        assert!(matches!(
            validate_computed(&duplicate_item),
            Err(PayloadError::ReferenceMismatch)
        ));

        let mut wrong_match_category = overall_resource(&resources, &kind);
        *wrong_match_category
            .payload
            .pointer_mut("/matchNoInEvent/entries/0/category")
            .unwrap_or_else(|| panic!("match category")) =
            Value::String(String::from("additional"));
        assert!(matches!(
            validate_computed(&wrong_match_category),
            Err(PayloadError::InvalidSchema)
        ));

        let mut wrong_player_order = overall_resource(&resources, &kind);
        wrong_player_order
            .payload
            .pointer_mut("/matchNoInEvent/entries/0/players")
            .and_then(Value::as_array_mut)
            .unwrap_or_else(|| panic!("match players"))
            .swap(0, 1);
        assert!(matches!(
            validate_computed(&wrong_player_order),
            Err(PayloadError::ReferenceMismatch)
        ));

        let mut wrong_match_order = overall_resource(&resources, &kind);
        wrong_match_order
            .payload
            .pointer_mut("/matchNoInEvent/entries")
            .and_then(Value::as_array_mut)
            .unwrap_or_else(|| panic!("match entries"))
            .swap(0, 1);
        assert!(matches!(
            validate_computed(&wrong_match_order),
            Err(PayloadError::InvalidSchema)
        ));
    }

    #[test]
    fn every_non_aggregate_variant_rejects_a_nested_contract_mutation() {
        let resources = compute_all(&input(2));

        let mut review = overall_resource(&resources, &ComputedResourceKind::Review);
        remove_field(&mut review, "/baseline", "qualityStatus");
        assert!(matches!(
            validate_computed(&review),
            Err(PayloadError::InvalidSchema)
        ));

        let variants = [
            (
                DrilldownMetric::RankAverageHistory,
                "/payload/summary",
                "currentAverageRank",
            ),
            (
                DrilldownMetric::PlayOrderRankHistory,
                "/payload/summary",
                "countsByPlayOrder",
            ),
            (
                DrilldownMetric::RankSignals,
                "/payload/method",
                "modelVersion",
            ),
            (
                DrilldownMetric::UnexpectedWins,
                "/payload/summary",
                "unexpectedWinCount",
            ),
        ];
        for (metric, pointer, field) in variants {
            let kind = ComputedResourceKind::Drilldown {
                member_id: String::from("member-1"),
                metric,
            };
            let mut resource = overall_resource(&resources, &kind);
            remove_field(&mut resource, pointer, field);
            assert!(
                matches!(
                    validate_computed(&resource),
                    Err(PayloadError::InvalidSchema)
                ),
                "mutation accepted: {metric:?}"
            );
        }

        let mut context = overall_resource(
            &resources,
            &ComputedResourceKind::MatchContext {
                match_id: String::from("match-1"),
            },
        );
        remove_field(&mut context, "/match/players/0", "revenueRank");
        assert!(matches!(
            validate_computed(&context),
            Err(PayloadError::InvalidSchema)
        ));
    }

    #[test]
    fn resource_set_rejects_dangling_focus_and_missing_drilldown() {
        let mut resources = compute_all(&input(1));
        let context = resources
            .iter_mut()
            .find(|resource| {
                resource.scope == ScopeRef::Overall
                    && resource.kind
                        == ComputedResourceKind::MatchContext {
                            match_id: String::from("match-1"),
                        }
            })
            .unwrap_or_else(|| panic!("overall context"));
        *context
            .payload
            .pointer_mut("/match/focusedItemIds/0")
            .unwrap_or_else(|| panic!("focused item")) =
            Value::String(String::from("missing:item"));
        let mut validator = PayloadSetValidator::new();
        for resource in &resources {
            assert!(validator.add_computed(resource).is_ok());
        }
        assert!(matches!(
            validator.finish(),
            Err(PayloadError::ReferenceMismatch)
        ));

        let mut incomplete_resources = compute_all(&input(1));
        incomplete_resources.retain(|resource| {
            resource.scope != ScopeRef::Overall
                || resource.kind
                    != ComputedResourceKind::Drilldown {
                        member_id: String::from("member-1"),
                        metric: DrilldownMetric::UnexpectedWins,
                    }
        });
        let mut incomplete_validator = PayloadSetValidator::new();
        for resource in &incomplete_resources {
            assert!(incomplete_validator.add_computed(resource).is_ok());
        }
        assert!(matches!(
            incomplete_validator.finish(),
            Err(PayloadError::ResourceSetMismatch)
        ));
    }
}
