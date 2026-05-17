package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.domain.{MatchExportFormat, MatchExportScope}
import momo.api.errors.AppError

/** Query parameter conversions for `ExportEndpoints`. */
object ExportCodec:
  def parseFormat(value: String): Either[AppError, MatchExportFormat] = MatchExportFormat
    .fromWire(value).toRight(AppError.ValidationFailed("format must be one of: csv, tsv."))

  def parseScope(
      seasonMasterId: Option[String],
      heldEventId: Option[String],
      matchId: Option[String],
  ): Either[AppError, MatchExportScope] =
    for
      season <- BoundaryId.optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
      event <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
      matchValue <- BoundaryId.optional("matchId", matchId)(MatchId.fromString)
      scopes = List(
        season.map(MatchExportScope.Season(_)),
        event.map(MatchExportScope.HeldEvent(_)),
        matchValue.map(MatchExportScope.Match(_)),
      ).flatten
      result <- scopes match
        case Nil => Right(MatchExportScope.All)
        case one :: Nil => Right(one)
        case _ => Left(AppError.ValidationFailed(
            "Specify at most one export scope: seasonMasterId, heldEventId, or matchId."
          ))
    yield result
end ExportCodec
