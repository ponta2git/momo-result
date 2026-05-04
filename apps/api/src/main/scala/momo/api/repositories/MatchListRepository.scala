package momo.api.repositories

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{MatchDraftStatus, MatchListItem}

trait MatchListRepository[F[_]]:
  def list(filter: MatchListRepository.Filter): F[List[MatchListItem]]

object MatchListRepository:
  enum StatusFilter derives CanEqual:
    case All
    case Incomplete
    case OcrRunning
    case PreConfirm
    case NeedsReview
    case Confirmed

  enum KindFilter derives CanEqual:
    case All
    case Match
    case MatchDraft

  final case class Filter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      status: StatusFilter = StatusFilter.All,
      kind: KindFilter = KindFilter.All,
      limit: Option[Int] = None,
  )

  val IncompleteStatuses: Set[MatchDraftStatus] = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )
