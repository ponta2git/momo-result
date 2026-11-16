use super::*;

const MEMBERS: [&str; PLAYER_COUNT] = ["a", "b", "c", "d"];

/// `(rank, revenue, destination, card shop)` of members `a`–`d` in one match.
type Spec = [(i32, i32, i32, i32); PLAYER_COUNT];

fn rows(specs: &[Spec]) -> Vec<PlayerMatchInput> {
    specs
        .iter()
        .enumerate()
        .flat_map(|(match_index, spec)| {
            spec.iter().zip(MEMBERS).enumerate().map(
                move |(slot, (&(rank, revenue, destination, card_shop), member))| {
                    PlayerMatchInput {
                        match_id: format!("match-{match_index:04}"),
                        match_revision: 1,
                        played_at: format!(
                            "2026-01-01T00:{:02}:{:02}.000000Z",
                            match_index / 60,
                            match_index % 60
                        ),
                        held_event_id: format!("event-{:03}", match_index / 4),
                        match_no_in_event: i32::try_from(match_index % 4 + 1)
                            .unwrap_or_else(|_| panic!("match number fits i32")),
                        season_master_id: String::from("season"),
                        map_master_id: String::from("map"),
                        owner_member_id: String::from("a"),
                        member_id: String::from(member),
                        play_order: i32::try_from(slot + 1)
                            .unwrap_or_else(|_| panic!("play order fits i32")),
                        rank,
                        total_assets_man_yen: (5 - rank) * 1_000,
                        revenue_man_yen: revenue,
                        incidents: IncidentCounts {
                            destination,
                            card_shop,
                            ..IncidentCounts::default()
                        },
                    }
                },
            )
        })
        .collect()
}

fn members() -> Vec<String> {
    MEMBERS.iter().map(|member| String::from(*member)).collect()
}

fn analyze_rows(owned: &[PlayerMatchInput]) -> ExpectedRankGap<'_> {
    let borrowed = owned.iter().collect::<Vec<_>>();
    analyze(
        "title",
        &borrowed,
        &members(),
        &CountLevels::from_rows(owned),
    )
}

/// The documented hand example: the layer "revenue 2nd, no destination" holds four results.
fn hand_example() -> Vec<PlayerMatchInput> {
    rows(&[
        [
            (1, 400, 1, 0),
            (2, 300, 0, 1),
            (3, 200, 1, 0),
            (4, 100, 1, 0),
        ],
        [
            (1, 400, 1, 0),
            (2, 200, 1, 0),
            (3, 300, 0, 0),
            (4, 100, 1, 0),
        ],
        [
            (1, 300, 0, 2),
            (2, 400, 1, 0),
            (3, 200, 1, 0),
            (4, 100, 1, 0),
        ],
        [
            (1, 400, 1, 0),
            (2, 300, 0, 0),
            (3, 200, 1, 0),
            (4, 100, 1, 0),
        ],
    ])
}

fn gap_of(gap: &ExpectedRankGap<'_>, member: &str, match_index: usize) -> Option<f64> {
    gap.evidence
        .iter()
        .find(|player| player.member_id == member)?
        .above
        .iter()
        .chain(
            &gap.evidence
                .iter()
                .find(|player| player.member_id == member)?
                .below,
        )
        .find(|row| row.match_index == match_index)
        .map(|row| row.cell.gap)
}

#[test]
fn the_hand_example_yields_the_layer_average_and_zero_sum_gaps() {
    let owned = hand_example();
    let gap = analyze_rows(&owned);
    assert_eq!(
        gap.status,
        Quality::Reference,
        "four matches are a reference scope"
    );
    let documented = gap
        .layers
        .iter()
        .find(|layer| layer.revenue_rank == 2 && layer.destination_levels == [0])
        .unwrap_or_else(|| panic!("the revenue-2nd layer exists"));
    assert_eq!(
        documented.count, 4,
        "the layer holds the four documented results"
    );
    assert!(
        (documented.expected_rank - 2.0).abs() < 1e-12,
        "(2 + 3 + 1 + 2) / 4"
    );
    assert_eq!(
        gap_of(&gap, "c", 2),
        Some(-1.0),
        "C finished one rank below"
    );
    assert_eq!(gap_of(&gap, "a", 3), Some(1.0), "A finished one rank above");
    assert_eq!(
        gap.layers.iter().map(|layer| layer.count).sum::<usize>(),
        16,
        "every result belongs to exactly one layer"
    );
    // Revenue 1st (1, 1, 2, 1) and revenue 3rd (3, 2, 3, 3) layers.
    assert_eq!(
        gap.layers
            .iter()
            .map(|layer| (layer.revenue_rank, layer.expected_rank))
            .collect::<Vec<_>>(),
        vec![(1, 1.25), (2, 2.0), (3, 2.75), (4, 4.0)],
        "expected ranks are the layer averages"
    );
}

#[test]
fn evidence_orders_larger_gaps_first_and_newer_matches_on_ties() {
    let owned = hand_example();
    let gap = analyze_rows(&owned);
    let evidence = |member: &str| {
        gap.evidence
            .iter()
            .find(|player| player.member_id == member)
            .unwrap_or_else(|| panic!("evidence exists for {member}"))
    };
    let order =
        |rows: &[EvidenceRow<'_>]| rows.iter().map(|row| row.match_index).collect::<Vec<_>>();
    assert_eq!(
        order(&evidence("a").above),
        vec![3, 4, 2, 1],
        "+1.0, then +0.25 newest first"
    );
    assert!(
        evidence("a").below.is_empty(),
        "A never finished below expectation"
    );
    assert_eq!(
        order(&evidence("c").below),
        vec![2, 4, 3, 1],
        "−1.0, then −0.25 newest first"
    );
    // B finished exactly as expected in matches 1 and 4; zero gaps are never evidence.
    assert_eq!(order(&evidence("b").above), vec![2]);
    assert_eq!(order(&evidence("b").below), vec![3]);
    assert!(
        evidence("d").above.is_empty() && evidence("d").below.is_empty(),
        "D always matched"
    );
}

#[test]
fn level_rows_partition_their_denominators_and_keep_observed_zero_apart_from_no_target() {
    let owned = hand_example();
    let gap = analyze_rows(&owned);
    let card_shop = gap
        .items
        .iter()
        .find(|item| item.item == Item::CardShop)
        .unwrap_or_else(|| panic!("card shop item exists"));
    assert_eq!(
        card_shop
            .levels
            .iter()
            .map(|level| level.overall.count)
            .collect::<Vec<_>>(),
        vec![14, 1, 1],
        "0 / 1 / 2+ levels partition all 16 results"
    );
    let single = card_shop.levels.get(1).map(|level| &level.overall);
    assert_eq!(
        single.map(|summary| summary.quality),
        Some(Quality::Reference)
    );
    let player_d = card_shop
        .levels
        .get(1)
        .and_then(|level| level.by_player.get(3))
        .unwrap_or_else(|| panic!("player D has a level row"));
    assert_eq!(player_d.count, 0, "D never stopped at a card shop");
    assert_eq!(
        player_d.share.to_bits(),
        0.0_f64.to_bits(),
        "the observed share is zero"
    );
    assert_eq!(player_d.mean_gap, None, "the mean gap has no target");
    assert_eq!(player_d.quality, Quality::NoTarget);
    for item in &gap.items {
        for (slot, player) in gap.players.iter().enumerate() {
            assert_eq!(
                item.levels
                    .iter()
                    .filter_map(|level| level.by_player.get(slot))
                    .map(|summary| summary.count)
                    .sum::<usize>(),
                player.summary.count,
                "each player's levels partition the player's matches"
            );
        }
    }
    for summary in gap.players.iter().map(|player| &player.summary).chain(
        gap.items
            .iter()
            .flat_map(|item| item.levels.iter().map(|level| &level.overall)),
    ) {
        if let (Some(expected), Some(average), Some(mean_gap)) = (
            summary.expected_rank,
            summary.average_rank,
            summary.mean_gap,
        ) {
            assert!(
                (expected - average - mean_gap).abs() < 1e-12,
                "the mean gap equals expected minus actual average rank"
            );
        }
    }
}

#[test]
fn scopes_without_three_matches_or_four_members_have_no_target() {
    let owned = hand_example();
    let borrowed = owned.iter().take(8).collect::<Vec<_>>();
    let levels = CountLevels::from_rows(&owned);
    let two = analyze("title", &borrowed, &members(), &levels);
    assert_eq!(two.status, Quality::NoTarget);
    assert_eq!(two.reason_codes, vec!["insufficient_matches"]);
    let all = owned.iter().collect::<Vec<_>>();
    let all_members = members();
    let first_three = all_members.get(..3).unwrap_or_default();
    let three_members = analyze("title", &all, first_three, &levels);
    assert_eq!(three_members.reason_codes, vec!["invalid_dataset"]);
}

/// Deterministic pseudo-random scopes whose ranks are unrelated to every other record.
fn null_scope(seed: u64, match_count: usize) -> Vec<PlayerMatchInput> {
    let mut random = judgement::Permutations::new(seed);
    let specs = (0..match_count)
        .map(|_| {
            let ranks = random.shuffle().unwrap_or_else(|| panic!("shuffle"));
            let revenue_order = random.shuffle().unwrap_or_else(|| panic!("shuffle"));
            let destinations = random.shuffle().unwrap_or_else(|| panic!("shuffle"));
            let shops = random.shuffle().unwrap_or_else(|| panic!("shuffle"));
            let mut spec = [(0, 0, 0, 0); PLAYER_COUNT];
            for (slot, cell) in spec.iter_mut().enumerate() {
                let pick = |values: [usize; PLAYER_COUNT]| {
                    i32::try_from(*values.get(slot).unwrap_or(&0))
                        .unwrap_or_else(|_| panic!("small index"))
                };
                *cell = (
                    pick(ranks) + 1,
                    pick(revenue_order) * 100,
                    pick(destinations) / 2,
                    pick(shops),
                );
            }
            spec
        })
        .collect::<Vec<_>>();
    rows(&specs)
}

#[test]
fn gaps_unrelated_to_records_rarely_receive_a_word() {
    let datasets = 24;
    let mut labelled_players = 0;
    let mut labelled_levels = 0;
    for seed in 0..datasets {
        let owned = null_scope(seed, 40);
        let gap = analyze_rows(&owned);
        assert_eq!(gap.status, Quality::Ok, "forty matches are judged");
        if gap
            .players
            .iter()
            .any(|player| player.summary.reported_signal().is_some())
        {
            labelled_players += 1;
        }
        if gap.items.iter().any(|item| {
            item.levels
                .iter()
                .any(|level| level.overall.reported_signal().is_some())
        }) {
            labelled_levels += 1;
        }
    }
    // Each family labels a null scope about one time in ten; 24 scopes stay well below 9.
    assert!(
        labelled_players <= 8,
        "player family: {labelled_players} of {datasets}"
    );
    assert!(
        labelled_levels <= 8,
        "level family: {labelled_levels} of {datasets}"
    );
}

#[test]
fn a_consistent_record_gap_is_a_trend_and_identical_input_repeats_the_judgement() {
    // Revenue 2nd finishes 1st with two card shops and 3rd without, so the shop results beat
    // their layer average (2.0) by one rank in every second match.
    let specs = (0..40)
        .map(|index| {
            if index % 2 == 0 {
                [
                    (2, 400, 0, 0),
                    (1, 300, 0, 2),
                    (3, 200, 0, 0),
                    (4, 100, 0, 0),
                ]
            } else {
                [
                    (1, 400, 0, 0),
                    (3, 300, 0, 0),
                    (2, 200, 0, 0),
                    (4, 100, 0, 0),
                ]
            }
        })
        .collect::<Vec<_>>();
    let owned = rows(&specs);
    let first = analyze_rows(&owned);
    let second = analyze_rows(&owned);
    let card_shop = first
        .items
        .iter()
        .find(|item| item.item == Item::CardShop)
        .unwrap_or_else(|| panic!("card shop item exists"));
    let top = card_shop
        .levels
        .last()
        .unwrap_or_else(|| panic!("card shop has levels"));
    assert_eq!(top.overall.reported_signal(), Some(Signal::Trend));
    assert!(
        top.overall.mean_gap > Some(0.0),
        "the shop results finished above expectation"
    );
    assert!(
        card_shop.background.is_some(),
        "a judged item carries its background"
    );
    assert_eq!(
        first.aggregate_json(),
        second.aggregate_json(),
        "same input, same artifact"
    );
    let text = first
        .aggregate_json()
        .pointer("/items/0/conclusion")
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    assert_eq!(
        text.as_deref(),
        Some("0回は見込みより下位、2回以上は上位の傾向"),
        "the conclusion names the levels and the direction only"
    );
}
