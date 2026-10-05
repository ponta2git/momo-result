package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, MemberId, SeasonMasterId}
import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkProjection,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}
import momo.api.errors.AppError

object SeriesAnalysisCodec:
  def outlook(
      rawGameTitleId: String,
      rawArtifactId: String,
      seasonMasterId: Option[String],
      rawMemberId: Option[String],
      projection: SeriesAnalysisChunkProjection,
      unsupportedScope: Boolean,
  ): Either[AppError, SeriesAnalysisChunkRequest] =
    for
      _ <- Either.cond(
        !unsupportedScope,
        (),
        AppError.ValidationFailed("This outlook resource does not support the supplied scope."),
      )
      _ <- projection match
        case SeriesAnalysisChunkProjection.OutlookWindow(size) =>
          Either.cond(
            size >= 1 && size <= 1000,
            (),
            AppError.ValidationFailed("windowSize must be between 1 and 1000.")
          )
        case _ => Right(())
      request <- chunk(
        if rawMemberId.isDefined then SeriesAnalysisChunkKind.OutlookReference
        else SeriesAnalysisChunkKind.OutlookSummary,
        rawGameTitleId,
        rawArtifactId,
        seasonMasterId,
        None,
        rawMemberId,
        None,
        None,
      )
    yield request.copy(projection = projection)

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

  def scope(
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
      case SeriesAnalysisChunkKind.Aggregate | SeriesAnalysisChunkKind.Review |
          SeriesAnalysisChunkKind.OutlookSummary =>
        memberId.isEmpty && metric.isEmpty && matchId.isEmpty
      case SeriesAnalysisChunkKind.Drilldown =>
        memberId.nonEmpty && metric.nonEmpty && matchId.isEmpty
      case SeriesAnalysisChunkKind.MatchContext =>
        memberId.isEmpty && metric.isEmpty && matchId.nonEmpty
      case SeriesAnalysisChunkKind.OutlookReference =>
        memberId.nonEmpty && metric.isEmpty && matchId.isEmpty
    Either.cond(valid, (), AppError.ValidationFailed("Invalid analysis resource query."))

  private val OpaqueIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$".r

  private def metric(value: String): Either[AppError, SeriesAnalysisDrilldownMetric] =
    opaqueId("metricId", value).flatMap(id =>
      SeriesAnalysisDrilldownMetric.fromId(id).toRight(
        AppError.ValidationFailed(
          s"metricId must be one of: ${SeriesAnalysisDrilldownMetric.supportedIds.mkString(", ")}."
        )
      )
    )

  private def opaqueId(field: String, value: String): Either[AppError, String] = BoundaryId
    .nonBlank(field, value).flatMap { id =>
      Either.cond(
        OpaqueIdPattern.matches(id),
        id,
        AppError.ValidationFailed(s"$field is invalid."),
      )
    }
