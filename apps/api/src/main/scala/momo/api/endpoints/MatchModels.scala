package momo.api.endpoints

import io.circe.Codec
import momo.api.domain.HeldEvent
import sttp.tapir.Schema

import java.time.format.DateTimeFormatter

final case class HeldEventResponse(
    id: String,
    name: String,
    heldAt: String,
    matchCount: Int
) derives Codec.AsObject

object HeldEventResponse:
  def from(e: HeldEvent): HeldEventResponse =
    HeldEventResponse(
      id = e.id,
      name = e.name,
      heldAt = DateTimeFormatter.ISO_INSTANT.format(e.heldAt),
      matchCount = e.matchCount
    )

final case class HeldEventListResponse(items: List[HeldEventResponse]) derives Codec.AsObject

final case class CreateHeldEventRequest(
    name: String,
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
    gameTitle: String,
    layoutFamily: String,
    seasonId: String,
    ownerMemberId: String,
    mapName: String,
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
