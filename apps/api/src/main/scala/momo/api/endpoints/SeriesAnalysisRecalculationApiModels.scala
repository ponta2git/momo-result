package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.SeriesAnalysisRecalculationAccepted

final case class SeriesAnalysisRecalculationRequest(gameTitleId: String) derives Codec.AsObject
final case class SeriesAnalysisAllRecalculationRequest(confirmation: String) derives Codec.AsObject
final case class SeriesAnalysisAcceptedCampaignResponse(campaignId: String, status: String)
    derives Codec.AsObject
final case class SeriesAnalysisAcceptedTargetResponse(
    gameTitleId: String,
    jobId: Option[String],
    requestDisposition: String,
) derives Codec.AsObject
final case class SeriesAnalysisRecalculationAcceptedResponse(
    schemaVersion: Int,
    requestId: String,
    acceptedAt: String,
    targetCount: Int,
    campaign: Option[SeriesAnalysisAcceptedCampaignResponse],
    target: Option[SeriesAnalysisAcceptedTargetResponse],
) derives Codec.AsObject

object SeriesAnalysisRecalculationAcceptedResponse:
  def from(
      value: SeriesAnalysisRecalculationAccepted
  ): SeriesAnalysisRecalculationAcceptedResponse = SeriesAnalysisRecalculationAcceptedResponse(
    1,
    value.requestId,
    DateTimeFormatter.ISO_INSTANT.format(value.acceptedAt),
    value.targetCount,
    value.campaign.map(value =>
      SeriesAnalysisAcceptedCampaignResponse(value.campaignId, value.status)
    ),
    value.target.map(value =>
      SeriesAnalysisAcceptedTargetResponse(
        value.gameTitleId.value,
        value.jobId,
        value.requestDisposition,
      )
    ),
  )
