package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.{MatchListItem, MatchRecord, PlayerResult}
import momo.api.usecases.heldevents.HeldEventDetail

final case class HeldEventPlayerResultResponse(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
) derives Codec.AsObject

object HeldEventPlayerResultResponse:
  def from(player: PlayerResult): HeldEventPlayerResultResponse = HeldEventPlayerResultResponse(
    memberId = player.memberId.value,
    playOrder = player.playOrder.value,
    rank = player.rank.value,
    totalAssetsManYen = player.totalAssetsManYen.value,
    revenueManYen = player.revenueManYen.value,
  )

final case class HeldEventMatchResponse(
    matchId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    seasonMasterId: String,
    ownerMemberId: String,
    mapMasterId: String,
    playedAt: String,
    players: List[HeldEventPlayerResultResponse],
    noteBody: Option[String],
) derives Codec.AsObject

object HeldEventMatchResponse:
  def from(record: MatchRecord): HeldEventMatchResponse = HeldEventMatchResponse(
    matchId = record.id.value,
    matchNoInEvent = record.matchNoInEvent.value,
    gameTitleId = record.gameTitleId.value,
    seasonMasterId = record.seasonMasterId.value,
    ownerMemberId = record.ownerMemberId.value,
    mapMasterId = record.mapMasterId.value,
    playedAt = DateTimeFormatter.ISO_INSTANT.format(record.playedAt),
    players = record.players.byPlayOrder.map(HeldEventPlayerResultResponse.from),
    noteBody = record.note.body.map(_.value),
  )

final case class HeldEventDraftResponse(
    matchDraftId: String,
    status: String,
    matchNoInEvent: Option[Int],
    gameTitleId: Option[String],
    seasonMasterId: Option[String],
    mapMasterId: Option[String],
    playedAt: Option[String],
    updatedAt: String,
) derives Codec.AsObject

object HeldEventDraftResponse:
  def from(item: MatchListItem): HeldEventDraftResponse = HeldEventDraftResponse(
    matchDraftId = item.matchDraftId.fold(item.id)(_.value),
    status = item.status,
    matchNoInEvent = item.matchNoInEvent.map(_.value),
    gameTitleId = item.gameTitleId.map(_.value),
    seasonMasterId = item.seasonMasterId.map(_.value),
    mapMasterId = item.mapMasterId.map(_.value),
    playedAt = item.playedAt.map(DateTimeFormatter.ISO_INSTANT.format),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(item.updatedAt),
  )

final case class HeldEventDetailResponse(
    id: String,
    heldAt: String,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
    matches: List[HeldEventMatchResponse],
    drafts: List[HeldEventDraftResponse],
) derives Codec.AsObject

object HeldEventDetailResponse:
  def from(detail: HeldEventDetail): HeldEventDetailResponse = HeldEventDetailResponse(
    id = detail.event.id.value,
    heldAt = DateTimeFormatter.ISO_INSTANT.format(detail.event.heldAt),
    matchCount = detail.matches.size,
    draftCount = detail.drafts.size,
    nextMatchNo = detail.nextMatchNo,
    matches = detail.matches.map(HeldEventMatchResponse.from),
    drafts = detail.drafts.map(HeldEventDraftResponse.from),
  )
