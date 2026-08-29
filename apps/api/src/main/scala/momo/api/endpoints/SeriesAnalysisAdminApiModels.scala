package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.{
  SeriesAnalysisAdminOverview,
  SeriesAnalysisGlobalExecution,
  SeriesAnalysisJobSummary,
  SeriesAnalysisVocabulary
}

final case class SeriesAnalysisAdminTitleOptionResponse(
    gameTitleId: String,
    gameTitleName: String,
    confirmedMatchCount: Long,
) derives Codec.AsObject
final case class SeriesAnalysisPendingManualRunResponse(
    requestCount: Int,
    oldestRequestedAt: String,
) derives Codec.AsObject
final case class SeriesAnalysisSelectedTitleResponse(
    gameTitleId: String,
    gameTitleName: String,
    status: SeriesAnalysisStatusResponse,
    pendingManualRun: Option[SeriesAnalysisPendingManualRunResponse],
) derives Codec.AsObject
final case class SeriesAnalysisCampaignSummaryResponse(
    campaignId: String,
    targetCount: Int,
    expandedCount: Int,
    terminalCount: Int,
    failedCount: Int,
    skippedCount: Int,
    acceptedAt: String,
) derives Codec.AsObject
final case class SeriesAnalysisGlobalExecutionResponse(
    runningCount: Int,
    queuedTitleCount: Int,
    oldestQueuedAt: Option[String],
    activeCampaignCount: Int,
    latestActiveCampaign: Option[SeriesAnalysisCampaignSummaryResponse],
) derives Codec.AsObject
final case class SeriesAnalysisRequesterResponse(accountId: String, displayName: String)
    derives Codec.AsObject
final case class SeriesAnalysisJobSummaryResponse(
    jobId: String,
    gameTitleId: String,
    gameTitleName: String,
    status: String,
    trigger: String,
    coalescedTriggers: List[String],
    requestedBy: String,
    manualRequestCount: Int,
    requestedAt: String,
    startedAt: Option[String],
    finishedAt: Option[String],
    elapsedMilliseconds: Option[Long],
    inputRevision: String,
    algorithmVersion: String,
    attemptCount: Int,
    transientRetryCount: Int,
    leaseRecoveryCount: Int,
    queueWaitMilliseconds: Option[Long],
    resultDisposition: String,
    firstManualRequester: Option[SeriesAnalysisRequesterResponse],
    safeFailureCode: Option[String],
) derives Codec.AsObject
final case class SeriesAnalysisAdminOverviewResponse(
    schemaVersion: Int,
    titleOptions: List[SeriesAnalysisAdminTitleOptionResponse],
    selectedTitle: Option[SeriesAnalysisSelectedTitleResponse],
    globalExecution: SeriesAnalysisGlobalExecutionResponse,
    recentJobs: List[SeriesAnalysisJobSummaryResponse],
) derives Codec.AsObject

object SeriesAnalysisAdminOverviewResponse:
  def from(value: SeriesAnalysisAdminOverview): SeriesAnalysisAdminOverviewResponse =
    SeriesAnalysisAdminOverviewResponse(
      SeriesAnalysisVocabulary.EnvelopeSchemaVersion,
      value.titleOptions.map(option =>
        SeriesAnalysisAdminTitleOptionResponse(
          option.gameTitleId.value,
          option.displayName,
          option.confirmedMatchCount,
        )
      ),
      value.selectedTitle.map(selected =>
        SeriesAnalysisSelectedTitleResponse(
          selected.gameTitleId.value,
          selected.gameTitleName,
          SeriesAnalysisStatusResponse.from(selected.status),
          selected.pendingManualRun.map(pending =>
            SeriesAnalysisPendingManualRunResponse(
              pending.requestCount,
              DateTimeFormatter.ISO_INSTANT.format(pending.oldestRequestedAt),
            )
          ),
        )
      ),
      global(value.globalExecution),
      value.recentJobs.map(job),
    )

  private def global(value: SeriesAnalysisGlobalExecution): SeriesAnalysisGlobalExecutionResponse =
    SeriesAnalysisGlobalExecutionResponse(
      value.runningCount,
      value.queuedTitleCount,
      value.oldestQueuedAt.map(DateTimeFormatter.ISO_INSTANT.format),
      value.activeCampaignCount,
      value.latestActiveCampaign.map(campaign =>
        SeriesAnalysisCampaignSummaryResponse(
          campaign.campaignId,
          campaign.targetCount,
          campaign.expandedCount,
          campaign.terminalCount,
          campaign.failedCount,
          campaign.skippedCount,
          DateTimeFormatter.ISO_INSTANT.format(campaign.acceptedAt),
        )
      ),
    )

  private def job(value: SeriesAnalysisJobSummary): SeriesAnalysisJobSummaryResponse =
    SeriesAnalysisJobSummaryResponse(
      value.jobId,
      value.gameTitleId.value,
      value.gameTitleName,
      value.status,
      value.trigger,
      value.coalescedTriggers,
      value.requestedBy,
      value.manualRequestCount,
      DateTimeFormatter.ISO_INSTANT.format(value.requestedAt),
      value.startedAt.map(DateTimeFormatter.ISO_INSTANT.format),
      value.finishedAt.map(DateTimeFormatter.ISO_INSTANT.format),
      value.elapsedMilliseconds,
      value.inputRevision.toString,
      value.algorithmVersion,
      value.attemptCount,
      value.transientRetryCount,
      value.leaseRecoveryCount,
      value.queueWaitMilliseconds,
      value.resultDisposition,
      value.firstManualRequester.map(requester =>
        SeriesAnalysisRequesterResponse(requester.accountId.value, requester.displayName)
      ),
      value.safeFailureCode,
    )
