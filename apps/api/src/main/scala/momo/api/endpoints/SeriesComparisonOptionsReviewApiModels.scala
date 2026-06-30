package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.view

type SeriesComparisonOptionsResponse = view.SeriesComparisonOptionsView
given Codec.AsObject[SeriesComparisonOptionsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonOptionsView]
given Schema[SeriesComparisonOptionsResponse] =
  Schema.derived[view.SeriesComparisonOptionsView].name(
    Schema.SName("SeriesComparisonOptionsResponse")
  )

type SeriesComparisonSeriesOption = view.SeriesComparisonSeriesOption
given Codec.AsObject[SeriesComparisonSeriesOption] =
  Codec.AsObject.derived[view.SeriesComparisonSeriesOption]
given Schema[SeriesComparisonSeriesOption] = Schema.derived[view.SeriesComparisonSeriesOption]

type SeriesComparisonScopeOption = view.SeriesComparisonScopeOption
given Codec.AsObject[SeriesComparisonScopeOption] =
  Codec.AsObject.derived[view.SeriesComparisonScopeOption]
given Schema[SeriesComparisonScopeOption] = Schema.derived[view.SeriesComparisonScopeOption]

type SeriesComparisonReviewBaselineResponse = view.SeriesComparisonReviewBaselineView
given Codec.AsObject[SeriesComparisonReviewBaselineResponse] =
  Codec.AsObject.derived[view.SeriesComparisonReviewBaselineView]
given Schema[SeriesComparisonReviewBaselineResponse] =
  Schema.derived[view.SeriesComparisonReviewBaselineView].name(
    Schema.SName("SeriesComparisonReviewBaselineResponse")
  )

type SeriesComparisonCommonPlaybookTopicResponse = view.SeriesComparisonCommonPlaybookTopicView
given Codec.AsObject[SeriesComparisonCommonPlaybookTopicResponse] =
  Codec.AsObject.derived[view.SeriesComparisonCommonPlaybookTopicView]
given Schema[SeriesComparisonCommonPlaybookTopicResponse] =
  Schema.derived[view.SeriesComparisonCommonPlaybookTopicView].name(
    Schema.SName("SeriesComparisonCommonPlaybookTopicResponse")
  )

type SeriesComparisonPlayerPlaybookResponse = view.SeriesComparisonPlayerPlaybookView
given Codec.AsObject[SeriesComparisonPlayerPlaybookResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerPlaybookView]
given Schema[SeriesComparisonPlayerPlaybookResponse] =
  Schema.derived[view.SeriesComparisonPlayerPlaybookView].name(
    Schema.SName("SeriesComparisonPlayerPlaybookResponse")
  )

type SeriesComparisonPlaybookCardResponse = view.SeriesComparisonPlaybookCardView
given Codec.AsObject[SeriesComparisonPlaybookCardResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookCardView]
given Schema[SeriesComparisonPlaybookCardResponse] =
  Schema.derived[view.SeriesComparisonPlaybookCardView].name(
    Schema.SName("SeriesComparisonPlaybookCardResponse")
  )

type SeriesComparisonPlaybookEvidenceResponse = view.SeriesComparisonPlaybookEvidenceView
given Codec.AsObject[SeriesComparisonPlaybookEvidenceResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookEvidenceView]
given Schema[SeriesComparisonPlaybookEvidenceResponse] =
  Schema.derived[view.SeriesComparisonPlaybookEvidenceView].name(
    Schema.SName("SeriesComparisonPlaybookEvidenceResponse")
  )

type SeriesComparisonPlaybookAnchorTargetResponse =
  view.SeriesComparisonPlaybookAnchorTargetView
given Codec.AsObject[SeriesComparisonPlaybookAnchorTargetResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlaybookAnchorTargetView]
given Schema[SeriesComparisonPlaybookAnchorTargetResponse] =
  Schema.derived[view.SeriesComparisonPlaybookAnchorTargetView].name(
    Schema.SName("SeriesComparisonPlaybookAnchorTargetResponse")
  )

type RecentFormPlayerResponse = view.RecentFormPlayerView
given Codec.AsObject[RecentFormPlayerResponse] =
  Codec.AsObject.derived[view.RecentFormPlayerView]
given Schema[RecentFormPlayerResponse] =
  Schema.derived[view.RecentFormPlayerView].name(Schema.SName("RecentFormPlayerResponse"))

type MomentumSwitchResponse = view.MomentumSwitchView
given Codec.AsObject[MomentumSwitchResponse] = Codec.AsObject.derived[view.MomentumSwitchView]
given Schema[MomentumSwitchResponse] =
  Schema.derived[view.MomentumSwitchView].name(Schema.SName("MomentumSwitchResponse"))

type MomentumSwitchPlayerResponse = view.MomentumSwitchPlayerView
given Codec.AsObject[MomentumSwitchPlayerResponse] =
  Codec.AsObject.derived[view.MomentumSwitchPlayerView]
given Schema[MomentumSwitchPlayerResponse] =
  Schema.derived[view.MomentumSwitchPlayerView].name(Schema.SName("MomentumSwitchPlayerResponse"))

type MomentumSwitchRateResponse = view.MomentumSwitchRateView
given Codec.AsObject[MomentumSwitchRateResponse] =
  Codec.AsObject.derived[view.MomentumSwitchRateView]
given Schema[MomentumSwitchRateResponse] =
  Schema.derived[view.MomentumSwitchRateView].name(Schema.SName("MomentumSwitchRateResponse"))

type MomentumSwitchTransitionRowResponse = view.MomentumSwitchTransitionRowView
given Codec.AsObject[MomentumSwitchTransitionRowResponse] =
  Codec.AsObject.derived[view.MomentumSwitchTransitionRowView]
given Schema[MomentumSwitchTransitionRowResponse] =
  Schema.derived[view.MomentumSwitchTransitionRowView].name(
    Schema.SName("MomentumSwitchTransitionRowResponse")
  )

type MomentumSwitchTransitionCellResponse = view.MomentumSwitchTransitionCellView
given Codec.AsObject[MomentumSwitchTransitionCellResponse] =
  Codec.AsObject.derived[view.MomentumSwitchTransitionCellView]
given Schema[MomentumSwitchTransitionCellResponse] =
  Schema.derived[view.MomentumSwitchTransitionCellView].name(
    Schema.SName("MomentumSwitchTransitionCellResponse")
  )

type PlayerPerformanceProfilesResponse = view.PlayerPerformanceProfilesView
given Codec.AsObject[PlayerPerformanceProfilesResponse] =
  Codec.AsObject.derived[view.PlayerPerformanceProfilesView]
given Schema[PlayerPerformanceProfilesResponse] =
  Schema.derived[view.PlayerPerformanceProfilesView].name(
    Schema.SName("PlayerPerformanceProfilesResponse")
  )

type PlayerPerformanceProfileResponse = view.PlayerPerformanceProfileView
given Codec.AsObject[PlayerPerformanceProfileResponse] =
  Codec.AsObject.derived[view.PlayerPerformanceProfileView]
given Schema[PlayerPerformanceProfileResponse] =
  Schema.derived[view.PlayerPerformanceProfileView].name(
    Schema.SName("PlayerPerformanceProfileResponse")
  )

type AssetStyleProfilesResponse = view.AssetStyleProfilesView
given Codec.AsObject[AssetStyleProfilesResponse] =
  Codec.AsObject.derived[view.AssetStyleProfilesView]
given Schema[AssetStyleProfilesResponse] =
  Schema.derived[view.AssetStyleProfilesView].name(Schema.SName("AssetStyleProfilesResponse"))

type AssetStyleProfileResponse = view.AssetStyleProfileView
given Codec.AsObject[AssetStyleProfileResponse] =
  Codec.AsObject.derived[view.AssetStyleProfileView]
given Schema[AssetStyleProfileResponse] =
  Schema.derived[view.AssetStyleProfileView].name(Schema.SName("AssetStyleProfileResponse"))

type AssetStyleMetricsResponse = view.AssetStyleMetricsView
given Codec.AsObject[AssetStyleMetricsResponse] =
  Codec.AsObject.derived[view.AssetStyleMetricsView]
given Schema[AssetStyleMetricsResponse] =
  Schema.derived[view.AssetStyleMetricsView].name(Schema.SName("AssetStyleMetricsResponse"))

type MatchNoInEventBreakdownResponse = view.MatchNoInEventBreakdownView
given Codec.AsObject[MatchNoInEventBreakdownResponse] =
  Codec.AsObject.derived[view.MatchNoInEventBreakdownView]
given Schema[MatchNoInEventBreakdownResponse] =
  Schema.derived[view.MatchNoInEventBreakdownView].name(
    Schema.SName("MatchNoInEventBreakdownResponse")
  )

type MatchNoInEventPlayerBreakdownResponse = view.MatchNoInEventPlayerBreakdownView
given Codec.AsObject[MatchNoInEventPlayerBreakdownResponse] =
  Codec.AsObject.derived[view.MatchNoInEventPlayerBreakdownView]
given Schema[MatchNoInEventPlayerBreakdownResponse] =
  Schema.derived[view.MatchNoInEventPlayerBreakdownView].name(
    Schema.SName("MatchNoInEventPlayerBreakdownResponse")
  )

type MatchTimelinePointResponse = view.MatchTimelinePointView
given Codec.AsObject[MatchTimelinePointResponse] =
  Codec.AsObject.derived[view.MatchTimelinePointView]
given Schema[MatchTimelinePointResponse] =
  Schema.derived[view.MatchTimelinePointView].name(Schema.SName("MatchTimelinePointResponse"))

type PlayOrderBaselineResponse = view.PlayOrderBaselineView
given Codec.AsObject[PlayOrderBaselineResponse] =
  Codec.AsObject.derived[view.PlayOrderBaselineView]
given Schema[PlayOrderBaselineResponse] =
  Schema.derived[view.PlayOrderBaselineView].name(Schema.SName("PlayOrderBaselineResponse"))

type SeriesComparisonHighlightResponse = view.SeriesComparisonHighlightView
given Codec.AsObject[SeriesComparisonHighlightResponse] =
  Codec.AsObject.derived[view.SeriesComparisonHighlightView]
given Schema[SeriesComparisonHighlightResponse] =
  Schema.derived[view.SeriesComparisonHighlightView].name(
    Schema.SName("SeriesComparisonHighlightResponse")
  )

type SeriesComparisonDataQualityResponse = view.SeriesComparisonDataQualityView
given Codec.AsObject[SeriesComparisonDataQualityResponse] =
  Codec.AsObject.derived[view.SeriesComparisonDataQualityView]
given Schema[SeriesComparisonDataQualityResponse] =
  Schema.derived[view.SeriesComparisonDataQualityView].name(
    Schema.SName("SeriesComparisonDataQualityResponse")
  )

type MetricQualityResponse = view.MetricQualityView
given Codec.AsObject[MetricQualityResponse] = Codec.AsObject.derived[view.MetricQualityView]
given Schema[MetricQualityResponse] =
  Schema.derived[view.MetricQualityView].name(Schema.SName("MetricQualityResponse"))
