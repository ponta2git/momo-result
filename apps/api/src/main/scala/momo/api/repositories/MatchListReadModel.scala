package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{MatchDraftStatus, MatchListItem}

trait MatchListAlg[F0[_]]:
  def list(filter: MatchListReadModel.Filter): F0[List[MatchListItem]]

trait MatchListReadModel[F[_]]:
  def list(filter: MatchListReadModel.Filter): F[List[MatchListItem]]

object MatchListReadModel:
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

  def fromConnectionIO[F[_]](
      alg: MatchListAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MatchListReadModel[F] = new MatchListReadModel[F]:
    def list(filter: Filter): F[List[MatchListItem]] = transactK(alg.list(filter))

  def liftIdentity[F[_]](alg: MatchListAlg[F]): MatchListReadModel[F] = new MatchListReadModel[F]:
    def list(filter: Filter): F[List[MatchListItem]] = alg.list(filter)
end MatchListReadModel
