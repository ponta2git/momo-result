package momo.api.endpoints

import io.circe.Codec
import java.time.format.DateTimeFormatter
import momo.api.domain.HeldEvent
import sttp.tapir.Schema

final case class HeldEventResponse(id: String, heldAt: String, matchCount: Int)
    derives Codec.AsObject

object HeldEventResponse:
  def from(e: HeldEvent, matchCount: Int): HeldEventResponse = HeldEventResponse(
    id = e.id,
    heldAt = DateTimeFormatter.ISO_INSTANT.format(e.heldAt),
    matchCount = matchCount,
  )

final case class HeldEventListResponse(items: List[HeldEventResponse]) derives Codec.AsObject

final case class CreateHeldEventRequest(heldAt: String) derives Codec.AsObject

final case class IncidentCountsRequest(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int,
) derives Codec.AsObject

object IncidentCountsRequest:
  given Schema[IncidentCountsRequest] = Schema.derived

final case class IncidentCountsResponse(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int,
) derives Codec.AsObject

object IncidentCountsResponse:
  given Schema[IncidentCountsResponse] = Schema.derived

final case class PlayerResultRequest(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCountsRequest,
) derives Codec.AsObject

final case class PlayerResultResponse(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCountsResponse,
) derives Codec.AsObject

final case class ConfirmMatchDraftIds(
    totalAssets: Option[String],
    revenue: Option[String],
    incidentLog: Option[String],
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
    players: List[PlayerResultRequest],
) derives Codec.AsObject

final case class ConfirmMatchResponse(
    matchId: String,
    heldEventId: String,
    matchNoInEvent: Int,
    createdAt: String,
) derives Codec.AsObject

final case class UpdateMatchRequest(
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    seasonMasterId: String,
    ownerMemberId: String,
    mapMasterId: String,
    playedAt: String,
    draftIds: ConfirmMatchDraftIds,
    players: List[PlayerResultRequest],
) derives Codec.AsObject

final case class MatchSummaryResponse(
    matchId: String,
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    seasonMasterId: String,
    mapMasterId: String,
    ownerMemberId: String,
    playedAt: String,
    createdAt: String,
    ranks: List[MatchRankEntry],
) derives Codec.AsObject

final case class MatchRankEntry(memberId: String, rank: Int, playOrder: Int) derives Codec.AsObject

final case class MatchListResponse(items: List[MatchSummaryResponse]) derives Codec.AsObject

final case class MatchDetailResponse(
    matchId: String,
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    layoutFamily: String,
    seasonMasterId: String,
    ownerMemberId: String,
    mapMasterId: String,
    playedAt: String,
    totalAssetsDraftId: Option[String],
    revenueDraftId: Option[String],
    incidentLogDraftId: Option[String],
    players: List[PlayerResultResponse],
    createdByMemberId: String,
    createdAt: String,
) derives Codec.AsObject

object MatchSummaryResponse:
  import momo.api.domain.MatchRecord
  def from(r: MatchRecord): MatchSummaryResponse = MatchSummaryResponse(
    matchId = r.id,
    heldEventId = r.heldEventId,
    matchNoInEvent = r.matchNoInEvent,
    gameTitleId = r.gameTitleId,
    seasonMasterId = r.seasonMasterId,
    mapMasterId = r.mapMasterId,
    ownerMemberId = r.ownerMemberId,
    playedAt = DateTimeFormatter.ISO_INSTANT.format(r.playedAt),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(r.createdAt),
    ranks = r.players.sortBy(_.playOrder)
      .map(p => MatchRankEntry(memberId = p.memberId, rank = p.rank, playOrder = p.playOrder)),
  )

object MatchDetailResponse:
  import momo.api.domain.MatchRecord
  def from(r: MatchRecord): MatchDetailResponse = MatchDetailResponse(
    matchId = r.id,
    heldEventId = r.heldEventId,
    matchNoInEvent = r.matchNoInEvent,
    gameTitleId = r.gameTitleId,
    layoutFamily = r.layoutFamily,
    seasonMasterId = r.seasonMasterId,
    ownerMemberId = r.ownerMemberId,
    mapMasterId = r.mapMasterId,
    playedAt = DateTimeFormatter.ISO_INSTANT.format(r.playedAt),
    totalAssetsDraftId = r.totalAssetsDraftId,
    revenueDraftId = r.revenueDraftId,
    incidentLogDraftId = r.incidentLogDraftId,
    players = r.players.sortBy(_.playOrder).map(p =>
      PlayerResultResponse(
        memberId = p.memberId,
        playOrder = p.playOrder,
        rank = p.rank,
        totalAssetsManYen = p.totalAssetsManYen,
        revenueManYen = p.revenueManYen,
        incidents = IncidentCountsResponse(
          destination = p.incidents.destination,
          plusStation = p.incidents.plusStation,
          minusStation = p.incidents.minusStation,
          cardStation = p.incidents.cardStation,
          cardShop = p.incidents.cardShop,
          suriNoGinji = p.incidents.suriNoGinji,
        ),
      )
    ),
    createdByMemberId = r.createdByMemberId,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(r.createdAt),
  )

final case class DeleteMatchResponse(matchId: String, deleted: Boolean) derives Codec.AsObject

final case class OcrDraftListResponse(items: List[OcrDraftResponse]) derives Codec.AsObject
