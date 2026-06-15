package momo.api.endpoints.codec

import momo.api.domain.SeriesComparisonScope
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.errors.AppError

object SeriesComparisonCodec:
  def parseAggregateQuery(
      gameTitleId: String,
      scopeKind: Option[String],
      scopeId: Option[String],
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    for
      parsedGameTitleId <- BoundaryId.required("gameTitleId", gameTitleId)(GameTitleId.fromString)
      parsed <- parseScope(parsedGameTitleId, scopeKind, scopeId, seasonMasterId, mapMasterId)
    yield parsed

  def parseReviewQuery(
      gameTitleId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    for
      parsedGameTitleId <- BoundaryId.required("gameTitleId", gameTitleId)(GameTitleId.fromString)
      scope <- parseFilterScope(parsedGameTitleId, seasonMasterId, mapMasterId)
    yield scope

  private def parseScope(
      gameTitleId: GameTitleId,
      scopeKind: Option[String],
      scopeId: Option[String],
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    val hasLegacyScope = nonBlank(scopeKind).nonEmpty || nonBlank(scopeId).nonEmpty
    val hasFilterScope = nonBlank(seasonMasterId).nonEmpty || nonBlank(mapMasterId).nonEmpty
    if hasLegacyScope && hasFilterScope then
      Left(AppError.ValidationFailed(
        "Specify either scopeKind/scopeId or seasonMasterId/mapMasterId, not both."
      ))
    else if hasLegacyScope then parseLegacyScope(gameTitleId, scopeKind, scopeId)
    else parseFilterScope(gameTitleId, seasonMasterId, mapMasterId)

  private def parseLegacyScope(
      gameTitleId: GameTitleId,
      scopeKind: Option[String],
      scopeId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    for
      kind <- parseScopeKind(scopeKind)
      parsed <- kind match
        case "overall" => nonBlank(scopeId) match
            case Some(_) => Left(AppError.ValidationFailed("scopeId must be omitted for overall."))
            case None => Right(SeriesComparisonScope.Overall(gameTitleId))
        case "season" => BoundaryId.optional("scopeId", scopeId)(SeasonMasterId.fromString)
            .flatMap {
              case Some(id) => Right(SeriesComparisonScope.Season(gameTitleId, id))
              case None => Left(AppError.ValidationFailed("scopeId is required for season scope."))
            }
        case "map" => BoundaryId.optional("scopeId", scopeId)(MapMasterId.fromString).flatMap {
            case Some(id) => Right(SeriesComparisonScope.Map(gameTitleId, id))
            case None => Left(AppError.ValidationFailed("scopeId is required for map scope."))
          }
    yield parsed

  private def parseFilterScope(
      gameTitleId: GameTitleId,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    for
      season <- BoundaryId.optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
      map <- BoundaryId.optional("mapMasterId", mapMasterId)(MapMasterId.fromString)
    yield (season, map) match
      case (Some(seasonId), Some(mapId)) => SeriesComparisonScope
          .SeasonMap(gameTitleId, seasonId, mapId)
      case (Some(seasonId), None) => SeriesComparisonScope.Season(gameTitleId, seasonId)
      case (None, Some(mapId)) => SeriesComparisonScope.Map(gameTitleId, mapId)
      case (None, None) => SeriesComparisonScope.Overall(gameTitleId)

  private def parseScopeKind(value: Option[String]): Either[AppError, String] =
    val raw = nonBlank(value).getOrElse("overall")
    if Set("overall", "season", "map").contains(raw) then Right(raw)
    else Left(AppError.ValidationFailed("scopeKind must be overall, season, or map."))

  private def nonBlank(value: Option[String]): Option[String] = value.map(_.trim).filter(_.nonEmpty)
