use std::collections::BTreeMap;

use serde::Deserialize;

use super::{RankSample, Ranks, SkipReason};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aggregate {
    metrics_by_player: Vec<Metric>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metric {
    member_id: String,
    denominator: u32,
    rank: Average,
}

#[derive(Deserialize)]
struct Average {
    average: Option<f64>,
}

pub(in crate::notifications::analysis) fn decode_ranks(bytes: &[u8]) -> Result<Ranks, SkipReason> {
    let aggregate: Aggregate =
        serde_json::from_slice(bytes).map_err(|_error| SkipReason::InvalidSnapshot)?;
    let mut ranks = BTreeMap::new();
    if aggregate.metrics_by_player.len() > 4 {
        return Err(SkipReason::InvalidSnapshot);
    }
    for metric in aggregate.metrics_by_player {
        let sample = RankSample {
            match_count: metric.denominator,
            average_rank: metric.rank.average,
        };
        if metric.member_id.is_empty()
            || metric.member_id.len() > 200
            || !sample
                .average_rank
                .map_or(sample.match_count == 0, |average| {
                    sample.match_count > 0 && (1.0..=4.0).contains(&average)
                })
            || ranks.insert(metric.member_id, sample).is_some()
        {
            return Err(SkipReason::InvalidSnapshot);
        }
    }
    Ok(ranks)
}
