package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.usecases.seriescomparison.view

type SeriesComparisonRankAnalysisResponse = view.SeriesComparisonRankAnalysisView
given Codec.AsObject[SeriesComparisonRankAnalysisResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankAnalysisView]
given Schema[SeriesComparisonRankAnalysisResponse] =
  Schema.derived[view.SeriesComparisonRankAnalysisView].name(
    Schema.SName("SeriesComparisonRankAnalysisResponse")
  )

type SeriesComparisonRankFoldScoreResponse = view.SeriesComparisonRankFoldScoreView
given Codec.AsObject[SeriesComparisonRankFoldScoreResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankFoldScoreView]
given Schema[SeriesComparisonRankFoldScoreResponse] =
  Schema.derived[view.SeriesComparisonRankFoldScoreView].name(
    Schema.SName("SeriesComparisonRankFoldScoreResponse")
  )

type SeriesComparisonPlayerRankSignalsResponse = view.SeriesComparisonPlayerRankSignalsView
given Codec.AsObject[SeriesComparisonPlayerRankSignalsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerRankSignalsView]
given Schema[SeriesComparisonPlayerRankSignalsResponse] =
  Schema.derived[view.SeriesComparisonPlayerRankSignalsView].name(
    Schema.SName("SeriesComparisonPlayerRankSignalsResponse")
  )

type SeriesComparisonRankSignalResponse = view.SeriesComparisonRankSignalView
given Codec.AsObject[SeriesComparisonRankSignalResponse] =
  Codec.AsObject.derived[view.SeriesComparisonRankSignalView]
given Schema[SeriesComparisonRankSignalResponse] =
  Schema.derived[view.SeriesComparisonRankSignalView].name(
    Schema.SName("SeriesComparisonRankSignalResponse")
  )

type SeriesComparisonPlayerUnexpectedWinsResponse =
  view.SeriesComparisonPlayerUnexpectedWinsView
given Codec.AsObject[SeriesComparisonPlayerUnexpectedWinsResponse] =
  Codec.AsObject.derived[view.SeriesComparisonPlayerUnexpectedWinsView]
given Schema[SeriesComparisonPlayerUnexpectedWinsResponse] =
  Schema.derived[view.SeriesComparisonPlayerUnexpectedWinsView].name(
    Schema.SName("SeriesComparisonPlayerUnexpectedWinsResponse")
  )

type SeriesComparisonUnexpectedWinSummaryResponse =
  view.SeriesComparisonUnexpectedWinSummaryView
given Codec.AsObject[SeriesComparisonUnexpectedWinSummaryResponse] =
  Codec.AsObject.derived[view.SeriesComparisonUnexpectedWinSummaryView]
given Schema[SeriesComparisonUnexpectedWinSummaryResponse] =
  Schema.derived[view.SeriesComparisonUnexpectedWinSummaryView].name(
    Schema.SName("SeriesComparisonUnexpectedWinSummaryResponse")
  )

type SeriesComparisonUnexpectedWinEvidenceResponse =
  view.SeriesComparisonUnexpectedWinEvidenceView
given Codec.AsObject[SeriesComparisonUnexpectedWinEvidenceResponse] =
  Codec.AsObject.derived[view.SeriesComparisonUnexpectedWinEvidenceView]
given Schema[SeriesComparisonUnexpectedWinEvidenceResponse] =
  Schema.derived[view.SeriesComparisonUnexpectedWinEvidenceView].name(
    Schema.SName("SeriesComparisonUnexpectedWinEvidenceResponse")
  )

type SeriesComparisonCrownCertaintyResponse = view.SeriesComparisonCrownCertaintyView
given Codec.AsObject[SeriesComparisonCrownCertaintyResponse] =
  Codec.AsObject.derived[view.SeriesComparisonCrownCertaintyView]
given Schema[SeriesComparisonCrownCertaintyResponse] =
  Schema.derived[view.SeriesComparisonCrownCertaintyView].name(
    Schema.SName("SeriesComparisonCrownCertaintyResponse")
  )

type SeriesComparisonCrownShareResponse = view.SeriesComparisonCrownShareView
given Codec.AsObject[SeriesComparisonCrownShareResponse] =
  Codec.AsObject.derived[view.SeriesComparisonCrownShareView]
given Schema[SeriesComparisonCrownShareResponse] =
  Schema.derived[view.SeriesComparisonCrownShareView].name(
    Schema.SName("SeriesComparisonCrownShareResponse")
  )
