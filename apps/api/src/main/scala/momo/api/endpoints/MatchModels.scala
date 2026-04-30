package momo.api.endpoints

import io.circe.Codec
import momo.api.domain.HeldEvent
import sttp.tapir.Schema

import java.time.format.DateTimeFormatter

final case class HeldEventResponse(
    id: String,
    heldAt: String,
    matchCount: Int
) derives Codec.AsObject

object HeldEventResponse:
  def from(e: HeldEvent, matchCount: Int): HeldEventResponse =
    HeldEventResponse(
      id = e.id,
      heldAt = DateTimeFormatter.ISO_INSTANT.format(e.heldAt),
      matchCount = matchCount
    )

final case class HeldEventListResponse(items: List[HeldEventResponse]) derives Codec.AsObject

final case class CreateHeldEventRequest(
    heldAt: String
) derives Codec.AsObject

final case class IncidentCountsRequest(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int
) derives Codec.AsObject

object IncidentCountsRequest:
  given Schema[IncidentCountsRequest] = Schema.derived

final case class IncidentCountsResponse(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int
) derives Codec.AsObject

object IncidentCountsResponse:
  given Schema[IncidentCountsResponse] = Schema.derived

final case class PlayerResultRequest(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCountsRequest
) derives Codec.AsObject

final case class PlayerResultResponse(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCountsResponse
) derives Codec.AsObject

final case class ConfirmMatchDraftIds(
    totalAssets: Option[String],
    revenue: Option[String],
    incidentLog: Option[String]
) derives Codec.AsObject

final case class ConfirmMatchRequest(
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    seasonMasterId: String,
    ownerMemberId: String,
    mapMasterId: String,
    playedAt: String,
    draftIds: ConfirmMatchDraftIds,
    players: List[PlayerResultRequest]
) derives Codec.AsObject

final case class ConfirmMatchResponse(
    matchId: String,
    heldEventId: String,
    matchNoInEvent: Int,
    createdAt: String
) derives Codec.AsObject

final case class OcrDraftListResponse(items: List[OcrDraftResponse]) derives Codec.AsObject
