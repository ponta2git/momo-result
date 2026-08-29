package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.{SeriesAnalysisArtifactRef, SeriesAnalysisStatus, SeriesAnalysisVocabulary}

final case class SeriesAnalysisDesiredResponse(
    inputRevision: String,
    algorithmVersion: String,
    artifactSchemaVersion: Int,
) derives Codec.AsObject

final case class SeriesAnalysisArtifactRefResponse(
    artifactId: String,
    gameTitleId: String,
    inputRevision: String,
    algorithmVersion: String,
    artifactSchemaVersion: Int,
    publishedAt: String,
) derives Codec.AsObject

object SeriesAnalysisArtifactRefResponse:
  def from(value: SeriesAnalysisArtifactRef): SeriesAnalysisArtifactRefResponse =
    SeriesAnalysisArtifactRefResponse(
      value.artifactId,
      value.gameTitleId.value,
      value.inputRevision.toString,
      value.algorithmVersion,
      value.artifactSchemaVersion,
      DateTimeFormatter.ISO_INSTANT.format(value.publishedAt),
    )

final case class SeriesAnalysisCalculationResponse(
    status: String,
    trigger: String,
    requestedAt: String,
    startedAt: Option[String],
    finishedAt: Option[String],
) derives Codec.AsObject

final case class SeriesAnalysisStatusResponse(
    schemaVersion: Int,
    gameTitleId: String,
    desired: SeriesAnalysisDesiredResponse,
    artifactFreshness: String,
    currentArtifact: Option[SeriesAnalysisArtifactRefResponse],
    calculation: Option[SeriesAnalysisCalculationResponse],
) derives Codec.AsObject

object SeriesAnalysisStatusResponse:
  def from(value: SeriesAnalysisStatus): SeriesAnalysisStatusResponse =
    SeriesAnalysisStatusResponse(
      schemaVersion = SeriesAnalysisVocabulary.EnvelopeSchemaVersion,
      gameTitleId = value.gameTitleId.value,
      desired = SeriesAnalysisDesiredResponse(
        value.desired.inputRevision.toString,
        value.desired.algorithmVersion,
        value.desired.artifactSchemaVersion,
      ),
      artifactFreshness = value.artifactFreshness,
      currentArtifact = value.currentArtifact.map(SeriesAnalysisArtifactRefResponse.from),
      calculation = value.calculation.map(calculation =>
        SeriesAnalysisCalculationResponse(
          calculation.status,
          calculation.trigger,
          DateTimeFormatter.ISO_INSTANT.format(calculation.requestedAt),
          calculation.startedAt.map(DateTimeFormatter.ISO_INSTANT.format),
          calculation.finishedAt.map(DateTimeFormatter.ISO_INSTANT.format),
        )
      ),
    )
