package momo.api.endpoints

import sttp.tapir.Schema

object SeriesAnalysisApiSchemas:
  given Schema[SeriesAnalysisDesiredResponse] = Schema.derived
  given Schema[SeriesAnalysisArtifactRefResponse] = Schema.derived
  given Schema[SeriesAnalysisCalculationResponse] = Schema.derived
  given Schema[SeriesAnalysisStatusResponse] = Schema.derived
  given Schema[SeriesAnalysisSeasonOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisMapOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisSeasonMapPairResponse] = Schema.derived
  given Schema[SeriesAnalysisTitleOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisOptionsResponse] = Schema.derived
  given Schema[SeriesAnalysisRecalculationRequest] = Schema.derived
  given Schema[SeriesAnalysisAllRecalculationRequest] = Schema.derived
  given Schema[SeriesAnalysisAcceptedCampaignResponse] = Schema.derived
  given Schema[SeriesAnalysisAcceptedTargetResponse] = Schema.derived
  given Schema[SeriesAnalysisRecalculationAcceptedResponse] = Schema.derived
  given Schema[SeriesAnalysisAdminTitleOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisPendingManualRunResponse] = Schema.derived
  given Schema[SeriesAnalysisSelectedTitleResponse] = Schema.derived
  given Schema[SeriesAnalysisCampaignSummaryResponse] = Schema.derived
  given Schema[SeriesAnalysisGlobalExecutionResponse] = Schema.derived
  given Schema[SeriesAnalysisRequesterResponse] = Schema.derived
  given Schema[SeriesAnalysisJobSummaryResponse] = Schema.derived
  given Schema[SeriesAnalysisAdminOverviewResponse] = Schema.derived
