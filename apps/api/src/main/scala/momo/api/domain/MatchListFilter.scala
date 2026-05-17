package momo.api.domain

enum MatchListStatusFilter derives CanEqual:
  case All
  case Incomplete
  case OcrRunning
  case PreConfirm
  case NeedsReview
  case Confirmed

object MatchListStatusFilter:
  val incompleteStatuses: Set[MatchDraftStatus] = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

enum MatchListKindFilter derives CanEqual:
  case All
  case Match
  case MatchDraft
