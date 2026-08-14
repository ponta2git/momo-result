package momo.api.domain

enum MatchListStatusFilter(val wire: String) derives CanEqual:
  case All extends MatchListStatusFilter("all")
  case Incomplete extends MatchListStatusFilter("incomplete")
  case OcrRunning extends MatchListStatusFilter("ocr_running")
  case PreConfirm extends MatchListStatusFilter("pre_confirm")
  case NeedsReview extends MatchListStatusFilter("needs_review")
  case Confirmed extends MatchListStatusFilter("confirmed")

object MatchListStatusFilter:
  def fromWire(value: String): Option[MatchListStatusFilter] = values.find(_.wire == value)

  val incompleteStatuses: Set[MatchDraftStatus] = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

enum MatchListKindFilter(val wire: String) derives CanEqual:
  case All extends MatchListKindFilter("all")
  case Match extends MatchListKindFilter("match")
  case MatchDraft extends MatchListKindFilter("match_draft")

object MatchListKindFilter:
  def fromWire(value: String): Option[MatchListKindFilter] = values.find(_.wire == value)

enum MatchListSort(val wire: String) derives CanEqual:
  case StatusPriority extends MatchListSort("status_priority")
  case UpdatedDesc extends MatchListSort("updated_desc")
  case HeldDesc extends MatchListSort("held_desc")
  case HeldAsc extends MatchListSort("held_asc")
  case MatchNoAsc extends MatchListSort("match_no_asc")

object MatchListSort:
  def fromWire(value: String): Option[MatchListSort] = values.find(_.wire == value)

final case class MatchListSummary(
    incompleteCount: Int,
    ocrRunningCount: Int,
    preConfirmCount: Int,
    needsReviewCount: Int,
)
