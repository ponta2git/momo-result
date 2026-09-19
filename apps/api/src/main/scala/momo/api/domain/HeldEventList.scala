package momo.api.domain

final case class HeldEventListPage(
    page: PagedResult[HeldEventListItem],
    totalMatchCount: Int,
)

final case class HeldEventListItem(
    event: HeldEvent,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
    scopes: List[HeldEventScopeSummary],
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
