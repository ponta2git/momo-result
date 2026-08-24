use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    model::PlayerMatchInput,
    numeric::count_as_f64,
    stats::{quality_status, rate},
};

#[derive(Clone, Copy, Debug, Default)]
struct ConditionalOutcomeTotals {
    target_count: usize,
    rank_total: f64,
    win_count: usize,
    podium_count: usize,
    assets_total: f64,
    revenue_total: f64,
}

impl ConditionalOutcomeTotals {
    fn add(&mut self, row: &PlayerMatchInput) {
        self.target_count = self.target_count.saturating_add(1);
        self.rank_total += f64::from(row.rank);
        self.win_count = self.win_count.saturating_add(usize::from(row.rank == 1));
        self.podium_count = self.podium_count.saturating_add(usize::from(row.rank <= 2));
        self.assets_total += f64::from(row.total_assets_man_yen);
        self.revenue_total += f64::from(row.revenue_man_yen);
    }

    fn average(self, total: f64) -> Option<f64> {
        count_as_f64(self.target_count)
            .filter(|count| *count > 0.0)
            .map(|count| total / count)
    }
}

pub(in crate::compute) fn card_shop_destination(
    players: &[String],
    player_matches_by_member: &BTreeMap<String, Vec<&PlayerMatchInput>>,
) -> Vec<Value> {
    let kinds = [
        "destination_with_shop",
        "destination_without_shop",
        "no_destination_with_shop",
        "no_destination_without_shop",
    ];
    players
        .iter()
        .map(|member_id| {
            let rows = player_matches_by_member
                .get(member_id)
                .map_or(&[][..], Vec::as_slice);
            let mut totals = [ConditionalOutcomeTotals::default(); 4];
            for row in rows {
                let index = match (
                    row.incidents.destination > 0,
                    row.incidents.card_shop > 0,
                ) {
                    (true, true) => 0,
                    (true, false) => 1,
                    (false, true) => 2,
                    (false, false) => 3,
                };
                if let Some(total) = totals.get_mut(index) {
                    total.add(row);
                }
            }
            let quadrants = kinds
                .into_iter()
                .zip(totals)
                .map(|(kind, total)| {
                    json!({
                        "itemId": format!("card-shop:{member_id}:{kind}"),
                        "kind": kind,
                        "targetCount": total.target_count,
                        "rate": rate(total.target_count, rows.len()),
                        "averageRank": total.average(total.rank_total),
                        "winRate": rate(total.win_count, total.target_count),
                        "podiumRate": rate(total.podium_count, total.target_count),
                        "averageAssets": total.average(total.assets_total),
                        "averageRevenue": total.average(total.revenue_total),
                        "qualityStatus": quality_status(total.target_count),
                    })
                })
                .collect::<Vec<_>>();
            let card_shop_count = totals
                .first()
                .zip(totals.get(2))
                .map_or(0, |(with_destination, without_destination)| {
                    with_destination
                        .target_count
                        .saturating_add(without_destination.target_count)
                });
            let card_shop_without_destination_count =
                totals.get(2).map_or(0, |total| total.target_count);
            json!({
                "memberId": member_id,
                "denominator": rows.len(),
                "cardShopMatchCount": card_shop_count,
                "cardShopRate": rate(card_shop_count, rows.len()),
                "cardShopWithoutDestinationCount": card_shop_without_destination_count,
                "cardShopWithoutDestinationRate": rate(card_shop_without_destination_count, card_shop_count),
                "quadrants": quadrants,
            })
        })
        .collect()
}
