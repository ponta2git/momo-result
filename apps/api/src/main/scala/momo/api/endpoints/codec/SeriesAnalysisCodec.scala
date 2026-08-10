package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, MemberId, SeasonMasterId}
import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}
import momo.api.errors.AppError

object SeriesAnalysisCodec:
  def gameTitleId(value: String): Either[AppError, GameTitleId] = BoundaryId
    .required("gameTitleId", value)(GameTitleId.fromString)

  def optionalGameTitleId(value: Option[String]): Either[AppError, Option[GameTitleId]] = value
    .traverse(gameTitleId)

  def chunk(
      kind: SeriesAnalysisChunkKind,
      rawGameTitleId: String,
      rawArtifactId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
      rawMemberId: Option[String],
      rawMetricId: Option[String],
      rawMatchId: Option[String],
  ): Either[AppError, SeriesAnalysisChunkRequest] =
    for
      titleId <- gameTitleId(rawGameTitleId)
      artifactId <- opaqueId("artifactId", rawArtifactId)
      scope <- scope(seasonMasterId, mapMasterId)
      memberId <- rawMemberId.traverse(value =>
        BoundaryId.required("memberId", value)(MemberId.fromString)
      )
      metric <- rawMetricId.traverse(metric)
      matchId <- rawMatchId.traverse(value =>
        BoundaryId.required("matchId", value)(MatchId.fromString)
      )
      _ <- validateKindFields(kind, memberId, metric, matchId)
    yield SeriesAnalysisChunkRequest(
      kind,
      titleId,
      artifactId,
      scope,
      memberId,
      metric,
      matchId,
    )

  private def scope(
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ): Either[AppError, SeriesAnalysisScope] =
    for
      season <- seasonMasterId.traverse(value =>
        BoundaryId.required("seasonMasterId", value)(SeasonMasterId.fromString)
      )
      map <- mapMasterId.traverse(value =>
        BoundaryId.required("mapMasterId", value)(MapMasterId.fromString)
      )
    yield (season, map) match
      case (None, None) => SeriesAnalysisScope.Overall
      case (Some(id), None) => SeriesAnalysisScope.Season(id)
      case (None, Some(id)) => SeriesAnalysisScope.Map(id)
      case (Some(seasonId), Some(mapId)) => SeriesAnalysisScope.SeasonMap(seasonId, mapId)

  private def validateKindFields(
      kind: SeriesAnalysisChunkKind,
      memberId: Option[MemberId],
      metric: Option[SeriesAnalysisDrilldownMetric],
      matchId: Option[MatchId],
  ): Either[AppError, Unit] =
    val valid = kind match
      case SeriesAnalysisChunkKind.Aggregate | SeriesAnalysisChunkKind.Review =>
        memberId.isEmpty && metric.isEmpty && matchId.isEmpty
      case SeriesAnalysisChunkKind.Drilldown =>
        memberId.nonEmpty && metric.nonEmpty && matchId.isEmpty
      case SeriesAnalysisChunkKind.MatchContext =>
        memberId.isEmpty && metric.isEmpty && matchId.nonEmpty
    Either.cond(valid, (), AppError.ValidationFailed("Invalid analysis resource query."))

  private val OpaqueIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$".r

  private def metric(value: String): Either[AppError, SeriesAnalysisDrilldownMetric] =
    opaqueId("metricId", value).flatMap(id => SeriesAnalysisDrilldownMetric.fromId(id).toRight(
      AppError.ValidationFailed(
        s"metricId must be one of: ${SeriesAnalysisDrilldownMetric.supportedIds.mkString(", ")}."
      )
    ))

  private def opaqueId(field: String, value: String): Either[AppError, String] = BoundaryId
    .nonBlank(field, value).flatMap { id =>
      Either.cond(
        OpaqueIdPattern.matches(id),
        id,
        AppError.ValidationFailed(s"$field is invalid."),
      )
    }
