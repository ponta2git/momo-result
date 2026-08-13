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
  MatchesRepository
}

final class InMemoryMatchConfirmationRepository[F[_]: Monad](
    matches: MatchesRepository[F],
    createMatch: MatchRecord => F[Unit],
    matchDrafts: InMemoryMatchDraftsRepository[F],
) extends MatchConfirmationRepository[F]:
  override def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[MatchConfirmationResult] = draft match
    case None => createMatch(record).as(MatchConfirmationResult.Confirmed)
    case Some(expected) =>
      for
        current <- matchDrafts.find(expected.draftId)
        updated <-
          if current.exists(matchesSnapshot(_, expected)) then
            createMatch(record) >>
              matchDrafts.markConfirmedUnchecked(expected.draftId, record.id, updatedAt).flatTap {
                case true => Monad[F].unit
                case false => matches.delete(record.id).void
              }
          else false.pure[F]
      yield updated match
        case true => MatchConfirmationResult.Confirmed
        case false => MatchConfirmationResult.DraftSnapshotMismatch

  private def matchesSnapshot(draft: MatchDraft, expected: MatchDraftConfirmation): Boolean = draft
    .updatedAt.equals(expected.updatedAt) &&
    draft.totalAssetsDraftId == expected.totalAssetsDraftId &&
    draft.revenueDraftId == expected.revenueDraftId &&
    draft.incidentLogDraftId == expected.incidentLogDraftId
