package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec
import sttp.tapir.Schema

import momo.api.domain.{HeldEvent, MatchListItem}

final case class HeldEventResponse(id: String, heldAt: String, matchCount: Int)
    derives Codec.AsObject

object HeldEventResponse:
  def from(e: HeldEvent, matchCount: Int): HeldEventResponse = HeldEventResponse(
    id = e.id.value,
    heldAt = DateTimeFormatter.ISO_INSTANT.format(e.heldAt),
    matchCount = matchCount,
  )

final case class HeldEventListResponse(items: List[HeldEventResponse]) derives Codec.AsObject

final case class CreateHeldEventRequest(heldAt: String) derives Codec.AsObject

final case class DeleteHeldEventResponse(heldEventId: String, deleted: Boolean)
    derives Codec.AsObject

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
    matchDraftId: Option[String],
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
    kind: String,
    id: String,
    matchId: Option[String],
    matchDraftId: Option[String],
    status: String,
    heldEventId: Option[String],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    seasonMasterId: Option[String],
    mapMasterId: Option[String],
    ownerMemberId: Option[String],
    playedAt: Option[String],
    createdAt: String,
    updatedAt: String,
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
    createdByAccountId: String,
    createdByMemberId: Option[String],
    createdAt: String,
) derives Codec.AsObject

object MatchSummaryResponse:
  def from(item: MatchListItem): MatchSummaryResponse = MatchSummaryResponse(
    kind = item.kind.wire,
    id = item.id,
    matchId = item.matchId.map(_.value),
    matchDraftId = item.matchDraftId.map(_.value),
    status = item.status,
    heldEventId = item.heldEventId.map(_.value),
    matchNoInEvent = item.matchNoInEvent,
    gameTitleId = item.gameTitleId.map(_.value),
    seasonMasterId = item.seasonMasterId.map(_.value),
    mapMasterId = item.mapMasterId.map(_.value),
    ownerMemberId = item.ownerMemberId.map(_.value),
    playedAt = item.playedAt.map(DateTimeFormatter.ISO_INSTANT.format),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(item.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(item.updatedAt),
    ranks = item.ranks
      .map(p => MatchRankEntry(memberId = p.memberId.value, rank = p.rank, playOrder = p.playOrder)),
  )

object MatchDetailResponse:
  import momo.api.domain.MatchRecord
  def from(r: MatchRecord): MatchDetailResponse = MatchDetailResponse(
    matchId = r.id.value,
    heldEventId = r.heldEventId.value,
    matchNoInEvent = r.matchNoInEvent,
    gameTitleId = r.gameTitleId.value,
    layoutFamily = r.layoutFamily,
    seasonMasterId = r.seasonMasterId.value,
    ownerMemberId = r.ownerMemberId.value,
    mapMasterId = r.mapMasterId.value,
    playedAt = DateTimeFormatter.ISO_INSTANT.format(r.playedAt),
    totalAssetsDraftId = r.totalAssetsDraftId.map(_.value),
    revenueDraftId = r.revenueDraftId.map(_.value),
    incidentLogDraftId = r.incidentLogDraftId.map(_.value),
    players = r.players.byPlayOrder.map(p =>
      PlayerResultResponse(
        memberId = p.memberId.value,
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
    createdByAccountId = r.createdByAccountId.value,
    createdByMemberId = r.createdByMemberId.map(_.value),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(r.createdAt),
  )

final case class DeleteMatchResponse(matchId: String, deleted: Boolean) derives Codec.AsObject

final case class OcrDraftListResponse(items: List[OcrDraftResponse]) derives Codec.AsObject
