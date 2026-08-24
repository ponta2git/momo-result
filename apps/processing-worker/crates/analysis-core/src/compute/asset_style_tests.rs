use super::*;

fn base(metrics: AssetStyleMetrics) -> AssetStyleBase<'static> {
    AssetStyleBase {
        member_id: "member",
        target_count: 100,
        metrics,
    }
}

fn medians() -> AssetStyleMedians {
    AssetStyleMedians {
        high_asset_rate: Some(0.10),
        low_asset_rate: Some(0.10),
        win_rate: Some(0.25),
        podium_rate: Some(0.50),
        second_rate: Some(0.25),
        blowout_win_rate: Some(0.10),
        win_median_assets: Some(100_000.0),
        win_median_margin: Some(10_000.0),
        lower_half_median_gap: Some(20_000.0),
        average_revenue_asset_rate: Some(0.10),
        destination_average: Some(1.0),
    }
}

#[test]
fn historical_primary_kind_priority_is_fixed() {
    let medians = medians();
    let cases = [
        (
            AssetStyleMetrics {
                high_asset_rate: Some(0.20),
                win_median_assets: Some(120_000.0),
                ..AssetStyleMetrics::default()
            },
            "asset_explosion",
        ),
        (
            AssetStyleMetrics {
                low_asset_rate: Some(0.20),
                win_rate: Some(0.25),
                ..AssetStyleMetrics::default()
            },
            "high_risk_breakthrough",
        ),
        (
            AssetStyleMetrics {
                blowout_win_count: 0,
                low_asset_rate: Some(0.10),
                ..AssetStyleMetrics::default()
            },
            "close_collector",
        ),
        (
            AssetStyleMetrics {
                blowout_win_count: 10,
                win_median_margin: Some(10_000.0),
                low_asset_rate: Some(0.05),
                podium_rate: Some(0.50),
                ..AssetStyleMetrics::default()
            },
            "steady_accumulator",
        ),
        (
            AssetStyleMetrics {
                blowout_win_count: 10,
                win_median_margin: Some(10_000.0),
                low_asset_rate: Some(0.10),
                second_rate: Some(0.35),
                ..AssetStyleMetrics::default()
            },
            "upper_chaser",
        ),
        (
            AssetStyleMetrics {
                blowout_win_count: 10,
                win_median_margin: Some(10_000.0),
                low_asset_rate: Some(0.10),
                second_rate: Some(0.25),
                ..AssetStyleMetrics::default()
            },
            "balanced",
        ),
    ];

    for (metrics, expected) in cases {
        assert_eq!(
            asset_style_primary_kind(&base(metrics), &medians),
            Some(expected)
        );
    }
}

#[test]
fn historical_shape_and_tag_order_are_fixed() {
    let medians = medians();
    let metrics = AssetStyleMetrics {
        high_asset_rate: Some(0.20),
        low_asset_rate: Some(0.12),
        second_rate: Some(0.35),
        average_revenue_asset_rate: Some(0.11),
        destination_average: Some(1.1),
        win_median_margin: Some(6_000.0),
        ..AssetStyleMetrics::default()
    };
    let base = base(metrics);
    let shape = asset_style_shape_kind(&base, &medians);

    assert_eq!(shape, Some("two_tailed"));
    assert_eq!(
        asset_style_tags(&base, &medians, shape),
        vec![
            "high_variance",
            "mobility_collecting",
            "upper_chaser",
            "property_base",
            "downside_risk",
            "close_finish",
        ]
    );
}
