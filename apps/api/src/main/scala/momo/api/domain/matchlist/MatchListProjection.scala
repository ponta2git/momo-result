package momo.api.domain.matchlist

import momo.api.domain.{
  MatchDraftStatus,
  MatchListItem,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummary
}

object MatchListProjection:
  val preConfirmStatuses: Set[MatchDraftStatus] = Set(
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

  def statusMatchesFilter(
      status: MatchDraftStatus,
      statusFilter: MatchListStatusFilter,
  ): Boolean = statusFilter match
    case MatchListStatusFilter.All => true
    case MatchListStatusFilter.Incomplete => MatchListStatusFilter.incompleteStatuses
        .contains(status)
    case MatchListStatusFilter.OcrRunning => status == MatchDraftStatus.OcrRunning
    case MatchListStatusFilter.PreConfirm => preConfirmStatuses.contains(status)
    case MatchListStatusFilter.NeedsReview => status == MatchDraftStatus.NeedsReview
    case MatchListStatusFilter.Confirmed => false

  def includeMatches(kind: MatchListKindFilter, statusFilter: MatchListStatusFilter): Boolean =
    kind match
      case MatchListKindFilter.Match => true
      case MatchListKindFilter.MatchDraft => false
      case MatchListKindFilter.All => statusFilter == MatchListStatusFilter.All ||
        statusFilter == MatchListStatusFilter.Confirmed

  def includeDrafts(kind: MatchListKindFilter, statusFilter: MatchListStatusFilter): Boolean =
    kind match
      case MatchListKindFilter.Match => false
      case MatchListKindFilter.MatchDraft => true
      case MatchListKindFilter.All => statusFilter != MatchListStatusFilter.Confirmed

  def summarizeDraftStatuses(statuses: Iterable[MatchDraftStatus]): MatchListSummary =
    statuses.foldLeft(MatchListSummary(0, 0, 0, 0)) { (summary, status) =>
      MatchListSummary(
        incompleteCount = summary.incompleteCount +
          (if MatchListStatusFilter.incompleteStatuses.contains(status) then 1 else 0),
        ocrRunningCount = summary.ocrRunningCount +
          (if status == MatchDraftStatus.OcrRunning then 1 else 0),
        preConfirmCount = summary.preConfirmCount +
          (if preConfirmStatuses.contains(status) then 1 else 0),
        needsReviewCount = summary.needsReviewCount +
          (if status == MatchDraftStatus.NeedsReview then 1 else 0),
      )
    }

  def displayPriority(status: MatchDraftStatus): Int = status match
    case MatchDraftStatus.OcrRunning => 0
    case MatchDraftStatus.NeedsReview => 1
    case MatchDraftStatus.DraftReady => 2
    case MatchDraftStatus.OcrFailed => 4
    case MatchDraftStatus.Confirmed => 5
    case _ => 3

  def sortItems(items: List[MatchListItem], sort: MatchListSort): List[MatchListItem] =
    def itemPriority(item: MatchListItem): Int =
      MatchDraftStatus.fromWire(item.status).map(displayPriority).getOrElse(3)
    def heldAt(item: MatchListItem): Long = item.playedAt.getOrElse(item.updatedAt).toEpochMilli

    sort match
      case MatchListSort.StatusPriority => items
          .sortBy(i => (itemPriority(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.UpdatedDesc => items
          .sortBy(i => (-i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.HeldDesc => items
          .sortBy(i => (-heldAt(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.HeldAsc => items
          .sortBy(i => (heldAt(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.MatchNoAsc => items.sortBy(i =>
          (
            i.matchNoInEvent.map(_.value).getOrElse(Int.MaxValue),
            -i.updatedAt.toEpochMilli,
            i.kind.wire,
            i.id,
          )
        )
