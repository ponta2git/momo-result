//! A single pass over one scope, with fixed storage for four players by four owners.
use serde_json::{Value, json};

use crate::{
    model::PlayerMatchInput,
    numeric::{count_as_f64, exact_i64_as_f64},
    stats::{quality_status, rate},
};

#[derive(Clone, Copy, Default)]
struct Cell {
    count: usize,
    ranks: [usize; 4],
    rank_sum: i64,
    assets: i64,
    revenue: i64,
    destination: i64,
    ginji: i64,
    encounters: usize,
}

impl Cell {
    fn add(&mut self, row: &PlayerMatchInput) -> Option<()> {
        self.count = self.count.checked_add(1)?;
        let rank = usize::try_from(row.rank.checked_sub(1)?).ok()?;
        let bucket = self.ranks.get_mut(rank)?;
        *bucket = bucket.checked_add(1)?;
        self.rank_sum = self.rank_sum.checked_add(i64::from(row.rank))?;
        self.assets = self
            .assets
            .checked_add(i64::from(row.total_assets_man_yen))?;
        self.revenue = self.revenue.checked_add(i64::from(row.revenue_man_yen))?;
        self.destination = self
            .destination
            .checked_add(i64::from(row.incidents.destination))?;
        self.ginji = self
            .ginji
            .checked_add(i64::from(row.incidents.suri_no_ginji))?;
        self.encounters = self
            .encounters
            .checked_add(usize::from(row.incidents.suri_no_ginji > 0))?;
        Some(())
    }

    fn payload(&self, owner: &str) -> Option<Value> {
        let denominator = count_as_f64(self.count)?;
        let averages = [
            self.rank_sum,
            self.assets,
            self.revenue,
            self.destination,
            self.ginji,
        ]
        .map(exact_i64_as_f64);
        let [
            Some(rank),
            Some(assets),
            Some(revenue),
            Some(destination),
            Some(ginji),
        ] = averages
        else {
            return None;
        };
        let average = |sum: f64| (self.count > 0).then(|| sum / denominator);
        Some(json!({
            "ownerMemberId": owner,
            "rank": {
                "average": average(rank),
                "distribution": self.ranks.iter().enumerate().map(|(index, count)| json!({
                    "rank": index + 1, "count": count, "rate": rate(*count, self.count)
                })).collect::<Vec<_>>()
            },
            "assets": {"average": average(assets)},
            "revenue": {"average": average(revenue)},
            "destination": {"count": self.destination, "average": average(destination)},
            "ginji": {
                "count": self.ginji, "average": average(ginji),
                "encounterMatches": self.encounters, "encounterRate": rate(self.encounters, self.count)
            }
        }))
    }
}

/// Builds the mandatory owner comparison in the existing roster order.
/// Normalized input bounds keep all integer sums exact. A broken input or checked
/// bound returns None, which the mandatory payload validator rejects before staging.
pub(super) fn build(rows: &[&PlayerMatchInput], players: &[String]) -> Option<Value> {
    if rows.is_empty() {
        return Some(json!({"owners": [], "rows": [], "recordedOwnerCount": 0}));
    }
    if players.len() != 4 {
        return None;
    }
    let mut cells = [[Cell::default(); 4]; 4];
    for row in rows {
        let player = players.iter().position(|id| id == &row.member_id)?;
        let owner = players.iter().position(|id| id == &row.owner_member_id)?;
        cells.get_mut(player)?.get_mut(owner)?.add(row)?;
    }
    let counts = cells.first()?.map(|cell| cell.count);
    let owners = players
        .iter()
        .zip(counts)
        .map(|(id, count)| {
            json!({
                "memberId": id, "targetCount": count, "qualityStatus": quality_status(count)
            })
        })
        .collect::<Vec<_>>();
    let matrix_rows = players
        .iter()
        .zip(cells)
        .map(|(id, cells)| {
            let values = cells
                .iter()
                .zip(players)
                .map(|(cell, owner)| cell.payload(owner))
                .collect::<Option<Vec<_>>>()?;
            Some(json!({"memberId": id, "cells": values}))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(
        json!({"owners": owners, "rows": matrix_rows, "recordedOwnerCount": counts.iter().filter(|count| **count > 0).count()}),
    )
}
