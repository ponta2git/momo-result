package momo.api.adapters.inmemory

import java.time.Instant

import cats.Monad
import cats.syntax.applicative.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*

import momo.api.domain.{MatchDraft, MatchRecord}
import momo.api.repositories.{
  MatchConfirmationRepository,
  MatchConfirmationResult,
  MatchDraftConfirmation,
  MatchDraftMarkConfirmedResult,
  MatchDraftsRepository,
  MatchesRepository
}

final class InMemoryMatchConfirmationRepository[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends MatchConfirmationRepository[F]:
  override def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[MatchConfirmationResult] = draft match
    case None => matches.create(record).as(MatchConfirmationResult.Confirmed)
    case Some(expected) =>
      for
        current <- matchDrafts.find(expected.draftId)
        updated <-
          if current.exists(matchesSnapshot(_, expected)) then
            matches.create(record) >>
              matchDrafts.markConfirmed(expected.draftId, record.id, updatedAt).flatTap {
                case MatchDraftMarkConfirmedResult.Confirmed => Monad[F].unit
                case MatchDraftMarkConfirmedResult.NotConfirmable => matches.delete(record.id).void
              }
          else MatchDraftMarkConfirmedResult.NotConfirmable.pure[F]
      yield updated match
        case MatchDraftMarkConfirmedResult.Confirmed => MatchConfirmationResult.Confirmed
        case MatchDraftMarkConfirmedResult.NotConfirmable =>
          MatchConfirmationResult.DraftSnapshotMismatch

  private def matchesSnapshot(draft: MatchDraft, expected: MatchDraftConfirmation): Boolean = draft
    .updatedAt.equals(expected.updatedAt) &&
    draft.totalAssetsDraftId == expected.totalAssetsDraftId &&
    draft.revenueDraftId == expected.revenueDraftId &&
    draft.incidentLogDraftId == expected.incidentLogDraftId
