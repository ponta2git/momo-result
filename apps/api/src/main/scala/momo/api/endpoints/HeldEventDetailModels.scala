package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec

import momo.api.domain.HeldEventDetail

final case class HeldEventPlayerResultResponse(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
) derives Codec.AsObject

object HeldEventPlayerResultResponse:
  def from(player: HeldEventDetail.Player): HeldEventPlayerResultResponse =
    HeldEventPlayerResultResponse(
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
    gameTitleName: Option[String] = None,
    seasonName: Option[String] = None,
    mapName: Option[String] = None,
) derives Codec.AsObject

object HeldEventMatchResponse:
  def from(record: HeldEventDetail.Match): HeldEventMatchResponse = HeldEventMatchResponse(
    matchId = record.id.value,
    matchNoInEvent = record.matchNoInEvent.value,
    gameTitleId = record.gameTitleId.value,
    seasonMasterId = record.seasonMasterId.value,
    ownerMemberId = record.ownerMemberId.value,
    mapMasterId = record.mapMasterId.value,
    playedAt = DateTimeFormatter.ISO_INSTANT.format(record.playedAt),
    players = record.players.map(HeldEventPlayerResultResponse.from),
    noteBody = record.noteBody,
    gameTitleName = record.labels.gameTitleName,
    seasonName = record.labels.seasonName,
    mapName = record.labels.mapName,
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
    gameTitleName: Option[String] = None,
    seasonName: Option[String] = None,
    mapName: Option[String] = None,
) derives Codec.AsObject

object HeldEventDraftResponse:
  def from(item: HeldEventDetail.Draft): HeldEventDraftResponse = HeldEventDraftResponse(
    matchDraftId = item.id.value,
    status = item.status.wire,
    matchNoInEvent = item.matchNoInEvent.map(_.value),
    gameTitleId = item.gameTitleId.map(_.value),
    seasonMasterId = item.seasonMasterId.map(_.value),
    mapMasterId = item.mapMasterId.map(_.value),
    playedAt = item.playedAt.map(DateTimeFormatter.ISO_INSTANT.format),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(item.updatedAt),
    gameTitleName = item.labels.gameTitleName,
    seasonName = item.labels.seasonName,
    mapName = item.labels.mapName,
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

final case class HeldEventSummaryResponse(
    id: String,
    heldAt: String,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
) derives Codec.AsObject

object HeldEventSummaryResponse:
  def from(summary: momo.api.domain.HeldEventSummary): HeldEventSummaryResponse =
    HeldEventSummaryResponse(
      summary.event.id.value,
      DateTimeFormatter.ISO_INSTANT.format(summary.event.heldAt),
      summary.matchCount,
      summary.draftCount,
      summary.nextMatchNo,
    )
