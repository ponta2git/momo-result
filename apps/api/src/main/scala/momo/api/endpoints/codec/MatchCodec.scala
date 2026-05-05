package momo.api.endpoints.codec

import momo.api.domain.ids.*
import momo.api.domain.{IncidentCounts, PlayerResult}
import momo.api.endpoints.{ConfirmMatchRequest, PlayerResultRequest, UpdateMatchRequest}
import momo.api.usecases.{ConfirmMatch, UpdateMatch}

/** DTO ↔ usecase command conversions for `MatchesEndpoints`. */
object MatchCodec:
  def toPlayerResult(player: PlayerResultRequest): PlayerResult = PlayerResult(
    memberId = MemberId(player.memberId),
    playOrder = player.playOrder,
    rank = player.rank,
    totalAssetsManYen = player.totalAssetsManYen,
    revenueManYen = player.revenueManYen,
    incidents = IncidentCounts(
      destination = player.incidents.destination,
      plusStation = player.incidents.plusStation,
      minusStation = player.incidents.minusStation,
      cardStation = player.incidents.cardStation,
      cardShop = player.incidents.cardShop,
      suriNoGinji = player.incidents.suriNoGinji,
    ),
  )

  def toConfirmCommand(request: ConfirmMatchRequest): ConfirmMatch.Command = ConfirmMatch.Command(
    heldEventId = HeldEventId(request.heldEventId),
    matchNoInEvent = request.matchNoInEvent,
    gameTitleId = GameTitleId(request.gameTitleId),
    seasonMasterId = SeasonMasterId(request.seasonMasterId),
    ownerMemberId = MemberId(request.ownerMemberId),
    mapMasterId = MapMasterId(request.mapMasterId),
    playedAt = request.playedAt,
    matchDraftId = request.matchDraftId.map(MatchDraftId(_)),
    draftRefs = ConfirmMatch.DraftRefs(
      totalAssets = request.draftIds.totalAssets.map(OcrDraftId(_)),
      revenue = request.draftIds.revenue.map(OcrDraftId(_)),
      incidentLog = request.draftIds.incidentLog.map(OcrDraftId(_)),
    ),
    players = request.players.map(toPlayerResult),
  )

  def toUpdateCommand(request: UpdateMatchRequest): UpdateMatch.Command = UpdateMatch.Command(
    heldEventId = HeldEventId(request.heldEventId),
    matchNoInEvent = request.matchNoInEvent,
    gameTitleId = GameTitleId(request.gameTitleId),
    seasonMasterId = SeasonMasterId(request.seasonMasterId),
    ownerMemberId = MemberId(request.ownerMemberId),
    mapMasterId = MapMasterId(request.mapMasterId),
    playedAt = request.playedAt,
    draftRefs = ConfirmMatch.DraftRefs(
      totalAssets = request.draftIds.totalAssets.map(OcrDraftId(_)),
      revenue = request.draftIds.revenue.map(OcrDraftId(_)),
      incidentLog = request.draftIds.incidentLog.map(OcrDraftId(_)),
    ),
    players = request.players.map(toPlayerResult),
  )
end MatchCodec
