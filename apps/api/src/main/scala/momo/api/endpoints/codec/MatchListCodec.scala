package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.usecases.ListMatchesCommand

/** Query-parameter ↔ command conversion for `MatchesEndpoints.list`. */
object MatchListCodec:
  def toListCommand(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: Option[String],
      kind: Option[String],
      limit: Option[Int],
  ): Either[AppError, ListMatchesCommand] =
    for
      parsedHeldEventId <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
      parsedGameTitleId <- BoundaryId.optional("gameTitleId", gameTitleId)(GameTitleId.fromString)
      parsedSeasonMasterId <- BoundaryId
        .optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
    yield ListMatchesCommand(
      heldEventId = parsedHeldEventId,
      gameTitleId = parsedGameTitleId,
      seasonMasterId = parsedSeasonMasterId,
      status = status,
      kind = kind,
      limit = limit,
    )
end MatchListCodec
