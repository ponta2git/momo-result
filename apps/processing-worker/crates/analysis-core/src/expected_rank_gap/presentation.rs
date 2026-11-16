//! Persisted payloads and Worker-owned sentences of the expected-rank gap.

use serde_json::{Value, json};

use super::{
    EvidenceRow, ExpectedRankGap, ItemGap, PERMUTATION_COUNT, Quality, Signal, Summary,
    background::{Background, Variable},
    levels::LevelBound,
};

const NO_RELATION: &str = "順位との結び付きは見られない";

impl ExpectedRankGap<'_> {
    #[must_use]
    pub(crate) fn aggregate_json(&self) -> Value {
        json!({
            "status": self.status.wire(),
            "reasonCodes": self.reason_codes,
            "matchCount": self.match_count,
            "permutationCount": PERMUTATION_COUNT,
            "hasMergedLayers": self.layers.iter().any(super::layers::Layer::merged),
            "layers": self.layers.iter().map(|layer| json!({
                "revenueRank": layer.revenue_rank,
                "destinationLevels": layer.destination_levels,
                "count": layer.count,
                "expectedRank": layer.expected_rank,
            })).collect::<Vec<_>>(),
            "players": self.players.iter().map(|player| {
                member_summary_json(&player.member_id, &player.summary)
            }).collect::<Vec<_>>(),
            "items": self.items.iter().map(|item| self.item_json(item)).collect::<Vec<_>>(),
        })
    }

    fn item_json(&self, item: &ItemGap) -> Value {
        json!({
            "item": item.item.code(),
            "conclusion": (self.status == Quality::Ok).then(|| conclusion(item)),
            "levels": item.levels.iter().zip(&item.bounds).map(|(level, bound)| json!({
                "minimumCount": bound.minimum,
                "maximumCount": bound.maximum,
                "overall": summary_json(&level.overall),
                "byPlayer": self.players.iter().zip(&level.by_player).map(|(player, summary)| {
                    member_summary_json(&player.member_id, summary)
                }).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "background": item.background.as_ref().map(|background| background_json(background, &item.bounds)),
        })
    }

    #[must_use]
    pub(crate) fn evidence_drilldown_json(&self, member_id: &str) -> Value {
        let player = self
            .evidence
            .iter()
            .find(|player| player.member_id == member_id);
        let rows = |rows: Option<&[EvidenceRow<'_>]>| {
            rows.unwrap_or_default()
                .iter()
                .map(evidence_row_json)
                .collect::<Vec<_>>()
        };
        json!({
            "kind": "expected_rank_gap_evidence",
            "summary": {
                "status": self.status.wire(),
                "matchCount": self.match_count,
                "aboveCount": player.map_or(0, |player| player.above_count),
                "belowCount": player.map_or(0, |player| player.below_count),
            },
            "above": rows(player.map(|player| player.above.as_slice())),
            "below": rows(player.map(|player| player.below.as_slice())),
        })
    }
}

fn summary_json(summary: &Summary) -> Value {
    json!({
        "count": summary.count,
        "share": summary.share,
        "expectedRank": summary.expected_rank,
        "averageRank": summary.average_rank,
        "meanGap": summary.mean_gap,
        "quality": summary.quality.wire(),
        "signal": summary.judged.map(|judged| judged.signal.wire()),
        "band": summary.judged.map(|judged| judged.band),
    })
}

fn member_summary_json(member_id: &str, summary: &Summary) -> Value {
    let mut value = summary_json(summary);
    if let Some(object) = value.as_object_mut() {
        object.insert(String::from("memberId"), Value::from(member_id));
    }
    value
}

fn evidence_row_json(row: &EvidenceRow<'_>) -> Value {
    let source = row.cell.row;
    json!({
        "matchIndex": row.match_index,
        "matchId": source.match_id,
        "heldEventId": source.held_event_id,
        "matchNoInEvent": source.match_no_in_event,
        "playedAt": source.played_at,
        "revenueRank": row.cell.revenue_rank,
        "expectedRank": row.cell.expected,
        "actualRank": source.rank,
        "gap": row.cell.gap,
        "evidence": {
            "revenueManYen": source.revenue_man_yen,
            "destinationCount": source.incidents.destination,
            "plusStationCount": source.incidents.plus_station,
            "minusStationCount": source.incidents.minus_station,
            "cardStationCount": source.incidents.card_station,
            "cardShopCount": source.incidents.card_shop,
            "ginjiCount": source.incidents.suri_no_ginji,
        },
    })
}

/// Row-group heading of one item: the record–result correspondence only, never a cause.
///
/// Directions follow the row order (fewer counts first), so the sentence reads like the table.
fn conclusion(item: &ItemGap) -> String {
    let parts = [(Signal::Trend, "傾向"), (Signal::Hint, "兆し")]
        .into_iter()
        .filter_map(|(signal, word)| {
            let mut groups = Vec::<(bool, Vec<String>)>::new();
            for (level, bound) in item.levels.iter().zip(&item.bounds) {
                let Some(gap) = level
                    .overall
                    .mean_gap
                    .filter(|_| level.overall.reported_signal() == Some(signal))
                else {
                    continue;
                };
                let above = gap > 0.0;
                match groups.iter_mut().find(|(direction, _)| *direction == above) {
                    Some((_, labels)) => labels.push(bound.label()),
                    None => groups.push((above, vec![bound.label()])),
                }
            }
            let phrase = |(index, (above, labels)): (usize, &(bool, Vec<String>))| {
                let direction = if *above { "上位" } else { "下位" };
                let subject = if index == 0 { "見込みより" } else { "" };
                format!("{}は{subject}{direction}", labels.join("・"))
            };
            (!groups.is_empty()).then(|| {
                let phrases = groups.iter().enumerate().map(phrase).collect::<Vec<_>>();
                format!("{}の{word}", phrases.join("、"))
            })
        })
        .collect::<Vec<_>>();
    if parts.is_empty() {
        String::from(NO_RELATION)
    } else {
        parts.join("。")
    }
}

fn background_json(background: &Background, bounds: &[LevelBound]) -> Value {
    json!({
        "summary": background_summary(background, bounds),
        "variables": background.variables.iter().map(|variable| variable.code()).collect::<Vec<_>>(),
        "rows": background.rows.iter().map(|row| json!({
            "levelIndex": row.level,
            "values": row.values.iter().map(|value| json!({
                "value": value.value,
                "marked": value.marked,
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}

/// Disclosure heading of a background: whether the revenue share differed, then the other
/// records that moved together. It states only observed differences; total assets stay in the
/// table because they are close to the saved rank itself.
fn background_summary(background: &Background, bounds: &[LevelBound]) -> String {
    let label = |level: usize| {
        bounds
            .get(level)
            .map_or_else(String::new, |bound| bound.label())
    };
    let marked = |variable_filter: fn(Variable) -> bool| {
        background
            .rows
            .iter()
            .filter_map(|row| {
                let parts = background
                    .variables
                    .iter()
                    .zip(&row.values)
                    .filter(|(variable, value)| variable_filter(**variable) && value.marked)
                    .map(|(variable, value)| (*variable, value.value > 0.0))
                    .collect::<Vec<_>>();
                (!parts.is_empty()).then(|| (label(row.level), parts))
            })
            .collect::<Vec<_>>()
    };
    let revenue = marked(|variable| variable == Variable::RevenueShare)
        .into_iter()
        .map(|(level, parts)| {
            let higher = parts.first().is_some_and(|(_, higher)| *higher);
            format!(
                "{level}の試合は物件収益のシェアが{}",
                if higher { "高い" } else { "低い" }
            )
        })
        .collect::<Vec<_>>();
    let others = marked(|variable| matches!(variable, Variable::Count(_)))
        .into_iter()
        .map(|(level, parts)| {
            let records = parts
                .iter()
                .filter_map(|(variable, more)| match variable {
                    Variable::Count(item) => Some(format!(
                        "{}が{}",
                        item.label(),
                        if *more { "多い" } else { "少ない" }
                    )),
                    Variable::RevenueShare | Variable::TotalAssets => None,
                })
                .collect::<Vec<_>>();
            format!("{level}の試合は{}", records.join("・"))
        })
        .collect::<Vec<_>>();
    let revenue = if revenue.is_empty() {
        String::from("物件収益のシェアに差は見られない")
    } else {
        revenue.join("、")
    };
    let others = if others.is_empty() {
        String::from("ほかの記録に一緒に動くものは見られない")
    } else {
        others.join("、")
    };
    format!("{revenue}。{others}")
}
