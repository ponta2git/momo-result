use std::collections::{BTreeMap, BTreeSet};

use crate::{model::PlayerMatchInput, numeric::count_as_f64, stats::average};

const MINIMUM_TARGET_COUNT: usize = 8;
const MINIMUM_EVENT_COUNT: usize = 3;
const BOOTSTRAP_ITERATIONS: usize = 96;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Interval {
    pub(super) low: f64,
    pub(super) high: f64,
}

pub(super) fn event_stability<'a>(
    target_rows: &[&'a PlayerMatchInput],
    baseline_rows: &[&'a PlayerMatchInput],
    full_effect: f64,
    compute: impl Fn(&[&'a PlayerMatchInput], &[&'a PlayerMatchInput]) -> Option<f64>,
) -> Option<f64> {
    let event_ids = baseline_rows
        .iter()
        .map(|row| row.held_event_id.as_str())
        .collect::<BTreeSet<_>>();
    if target_rows.len() < MINIMUM_TARGET_COUNT || event_ids.len() < MINIMUM_EVENT_COUNT {
        return None;
    }
    let reduced_effects = event_ids
        .into_iter()
        .filter_map(|event_id| {
            let target = target_rows
                .iter()
                .copied()
                .filter(|row| row.held_event_id != event_id)
                .collect::<Vec<_>>();
            let baseline = baseline_rows
                .iter()
                .copied()
                .filter(|row| row.held_event_id != event_id)
                .collect::<Vec<_>>();
            compute(&target, &baseline).filter(|value| value.is_finite())
        })
        .collect::<Vec<_>>();
    if reduced_effects.is_empty() {
        return None;
    }
    let sign = full_effect.signum();
    let same_direction_count = reduced_effects
        .iter()
        .filter(|value| (value.signum() - sign).abs() < f64::EPSILON || value.abs() < 0.0001)
        .count();
    let same_direction = count_as_f64(same_direction_count)? / count_as_f64(reduced_effects.len())?;
    let magnitude = average(
        reduced_effects
            .iter()
            .map(|value| (value.abs() / (full_effect.abs() + 0.0001)).clamp(0.0, 1.0)),
    )?;
    Some(
        (0.65 * same_direction)
            .mul_add(magnitude, 0.35)
            .clamp(0.0, 1.0),
    )
}

pub(super) fn event_bootstrap_interval<'a>(
    member_id: &str,
    category: &str,
    metric_id: &str,
    rows: &[&'a PlayerMatchInput],
    compute: impl Fn(&[&'a PlayerMatchInput]) -> Option<f64>,
) -> Option<Interval> {
    let mut rows_by_event = BTreeMap::<&str, Vec<&PlayerMatchInput>>::new();
    for row in rows {
        rows_by_event
            .entry(row.held_event_id.as_str())
            .or_default()
            .push(row);
    }
    if rows.len() < MINIMUM_TARGET_COUNT || rows_by_event.len() < MINIMUM_EVENT_COUNT {
        return None;
    }
    let event_rows = rows_by_event.into_values().collect::<Vec<_>>();
    let mut random = StableRandom::new(stable_seed(member_id, category, metric_id));
    let mut effects = (0..BOOTSTRAP_ITERATIONS)
        .filter_map(|_| {
            let sampled = (0..event_rows.len())
                .flat_map(|_| {
                    random
                        .index(event_rows.len())
                        .and_then(|index| event_rows.get(index))
                        .into_iter()
                        .flat_map(|event_group| event_group.iter().copied())
                })
                .collect::<Vec<_>>();
            compute(&sampled).filter(|value| value.is_finite())
        })
        .collect::<Vec<_>>();
    if effects.len() < 8 {
        return None;
    }
    effects.sort_by(f64::total_cmp);
    let last = effects.len() - 1;
    let low_index = last.saturating_mul(25) / 1_000;
    let high_index = last.saturating_mul(975).saturating_add(999) / 1_000;
    Some(Interval {
        low: *effects.get(low_index)?,
        high: *effects.get(high_index.min(last))?,
    })
}

fn stable_seed(member_id: &str, category: &str, metric_id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in member_id
        .bytes()
        .chain([0xff])
        .chain(category.bytes())
        .chain([0xfe])
        .chain(metric_id.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

struct StableRandom(u64);

impl StableRandom {
    const fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x9e37_79b9_7f4a_7c15
        } else {
            seed
        })
    }

    fn index(&mut self, upper: usize) -> Option<usize> {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        let upper = u64::try_from(upper).ok().filter(|value| *value > 0)?;
        usize::try_from(self.0 % upper).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::IncidentCounts;

    fn row(index: i32, event: i32, rank: i32) -> PlayerMatchInput {
        PlayerMatchInput {
            match_id: format!("match-{index}"),
            match_revision: 1,
            played_at: format!("2026-01-{index:02}T00:00:00.000000Z"),
            held_event_id: format!("event-{event}"),
            match_no_in_event: index,
            season_master_id: String::from("season"),
            map_master_id: String::from("map"),
            member_id: String::from("member"),
            play_order: 1,
            rank,
            total_assets_man_yen: 100,
            revenue_man_yen: 10,
            incidents: IncidentCounts::default(),
        }
    }

    #[test]
    fn stable_seed_uses_all_utf8_identity_parts() {
        assert_eq!(
            stable_seed("ぽんた", "accident", "driver"),
            0x8683_d033_0b52_1c33
        );
        assert_ne!(
            stable_seed("ぽんた", "accident", "driver"),
            stable_seed("ぽんた", "destinationPositive", "driver")
        );
    }

    #[test]
    fn event_statistics_are_deterministic_and_hide_small_samples() {
        let owned = (0..12)
            .map(|index| row(index + 1, index / 3, index % 4 + 1))
            .collect::<Vec<_>>();
        let rows = owned.iter().collect::<Vec<_>>();
        let compute =
            |sample: &[&PlayerMatchInput]| average(sample.iter().map(|row| f64::from(row.rank)));

        let first = event_bootstrap_interval("member", "accident", "driver", &rows, compute);
        let second = event_bootstrap_interval("member", "accident", "driver", &rows, compute);

        assert_eq!(first, second);
        assert!(first.is_some());
        let small_rows = rows.get(..7).unwrap_or(&[]);
        assert!(
            event_bootstrap_interval("member", "accident", "driver", small_rows, compute).is_none()
        );
        assert!(
            event_stability(small_rows, &rows, 0.2, |target, _| {
                average(target.iter().map(|row| f64::from(row.rank)))
            })
            .is_none()
        );
    }
}
