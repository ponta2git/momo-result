package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

/** Facts needed by a held-event view; excludes OCR lineage, audit metadata and incident logs. */
final case class HeldEventDetail(
    event: HeldEvent,
    matches: List[HeldEventDetail.Match],
    drafts: List[HeldEventDetail.Draft],
):
  def nextMatchNo: Int =
    (matches.iterator.map(_.matchNoInEvent.value) ++
      drafts.iterator.flatMap(_.matchNoInEvent.map(_.value))).maxOption.getOrElse(0) + 1

object HeldEventDetail:
  final case class Player(
      memberId: MemberId,
      playOrder: PlayOrder,
      rank: Rank,
      totalAssetsManYen: ManYen,
      revenueManYen: ManYen,
  )

  final case class Match(
      id: MatchId,
      matchNoInEvent: MatchNoInEvent,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      noteBody: Option[String],
      players: List[Player],
      labels: MatchLabels = MatchLabels.empty,
  )

  final case class Draft(
      id: MatchDraftId,
      status: MatchDraftStatus,
      matchNoInEvent: Option[MatchNoInEvent],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
      mapMasterId: Option[MapMasterId],
      playedAt: Option[Instant],
      updatedAt: Instant,
      labels: MatchLabels = MatchLabels.empty,
  )

/** Counts and identity for a selector; no match results, notes or OCR payloads. */
final case class HeldEventSummary(
    event: HeldEvent,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
)
