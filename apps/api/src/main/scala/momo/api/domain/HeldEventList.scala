package momo.api.domain

import momo.api.domain.ids.{HeldEventId, MatchId, MemberId}

/** `latestHeldEventId` is the newest event regardless of search, sort and page. */
final case class HeldEventListPage(
    page: PagedResult[HeldEventListItem],
    totalMatchCount: Int,
    latestHeldEventId: Option[HeldEventId],
)

final case class HeldEventListItem(
    event: HeldEvent,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
    scopes: List[HeldEventScopeSummary],
    playerResults: List[HeldEventPlayerResult],
    noteMatch: Option[HeldEventNoteMatch],
)

/** `averageRank` is rounded to two decimals; `rankCounts` holds the 1st..4th counts. */
final case class HeldEventPlayerResult(
    memberId: MemberId,
    averageRank: BigDecimal,
    rankCounts: List[Int],
)

/** The first confirmed match whose note contains the searched phrase. */
final case class HeldEventNoteMatch(
    matchId: MatchId,
    matchNoInEvent: Int,
    noteBody: String,
    otherMatchCount: Int,
)

final case class HeldEventScopeSummary(
    scope: HeldEventScope,
    gameTitleName: Option[String],
    seasonName: Option[String],
)

object HeldEventScopeSummary:
  def ordered(scopes: List[HeldEventScopeSummary]): List[HeldEventScopeSummary] =
    scopes.filter(_.scope.isDefined).distinct.sortBy(summary =>
      (
        summary.gameTitleName.getOrElse(""),
        summary.seasonName.getOrElse(""),
        summary.scope.gameTitleId.map(_.value).getOrElse(""),
        summary.scope.seasonMasterId.map(_.value).getOrElse(""),
      )
    )
