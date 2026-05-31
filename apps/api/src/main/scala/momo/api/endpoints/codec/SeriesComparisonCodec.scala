package momo.api.endpoints.codec

import momo.api.domain.SeriesComparisonScope
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.errors.AppError

object SeriesComparisonCodec:
  def parseAggregateQuery(
      gameTitleId: String,
      scopeKind: Option[String],
      scopeId: Option[String],
  ): Either[AppError, SeriesComparisonScope] =
    for
      parsedGameTitleId <- BoundaryId.required("gameTitleId", gameTitleId)(GameTitleId.fromString)
      kind <- parseScopeKind(scopeKind)
      parsed <- kind match
        case "overall" => scopeId.filter(_.trim.nonEmpty) match
            case Some(_) => Left(AppError.ValidationFailed("scopeId must be omitted for overall."))
            case None => Right(SeriesComparisonScope.Overall(parsedGameTitleId))
        case "season" => BoundaryId.optional("scopeId", scopeId)(SeasonMasterId.fromString)
            .flatMap {
              case Some(id) => Right(SeriesComparisonScope.Season(parsedGameTitleId, id))
              case None => Left(AppError.ValidationFailed("scopeId is required for season scope."))
            }
        case "map" => BoundaryId.optional("scopeId", scopeId)(MapMasterId.fromString).flatMap {
            case Some(id) => Right(SeriesComparisonScope.Map(parsedGameTitleId, id))
            case None => Left(AppError.ValidationFailed("scopeId is required for map scope."))
          }
    yield parsed

  private def parseScopeKind(value: Option[String]): Either[AppError, String] =
    val raw = value.map(_.trim).filter(_.nonEmpty).getOrElse("overall")
    if Set("overall", "season", "map").contains(raw) then Right(raw)
    else Left(AppError.ValidationFailed("scopeKind must be overall, season, or map."))
