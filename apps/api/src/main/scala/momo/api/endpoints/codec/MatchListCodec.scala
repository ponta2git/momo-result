package momo.api.endpoints.codec

import momo.api.domain.ids.*
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
  ): ListMatchesCommand = ListMatchesCommand(
    heldEventId = heldEventId.map(HeldEventId(_)),
    gameTitleId = gameTitleId.map(GameTitleId(_)),
    seasonMasterId = seasonMasterId.map(SeasonMasterId(_)),
    status = status,
    kind = kind,
    limit = limit,
  )
end MatchListCodec
