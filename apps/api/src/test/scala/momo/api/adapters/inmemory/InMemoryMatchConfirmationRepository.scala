package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*

import momo.api.domain.{AddMatchAchievement, MatchDraftConfirmability, MatchRecord}
import momo.api.errors.AppError
import momo.api.repositories.{
  MatchConfirmationRepository,
  MatchConfirmationResult,
  MatchDraftConfirmation,
  MatchesRepository,
  RepositoryResult
}

final class InMemoryMatchConfirmationRepository[F[_]: MonadCancelThrow](
    matches: MatchesRepository[F],
    createMatch: MatchRecord => F[Unit],
    matchDrafts: InMemoryMatchDraftsRepository[F],
) extends MatchConfirmationRepository[F]:
  override def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
      achievements: List[AddMatchAchievement],
  ): F[Either[AppError, MatchConfirmationResult]] =
    if achievements.nonEmpty then
      Left(AppError.ValidationFailed("Achievement persistence requires a PostgreSQL fixture."))
        .pure[F]
    else RepositoryResult.capture(confirmUnchecked(record, draft, updatedAt))

  private def confirmUnchecked(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[MatchConfirmationResult] = draft match
    case None => createMatch(record).as(MatchConfirmationResult.Confirmed)
    case Some(expected) =>
      for
        current <- matchDrafts.find(expected.draftId)
        updated <-
          if current.exists(draft =>
              MatchDraftConfirmability.allows(draft.status) &&
                MatchDraftConfirmation.from(draft) == expected
            )
          then
            createAndConfirm(record, expected, updatedAt)
          else false.pure[F]
      yield updated match
        case true => MatchConfirmationResult.Confirmed
        case false => MatchConfirmationResult.DraftSnapshotMismatch

  private def createAndConfirm(
      record: MatchRecord,
      expected: MatchDraftConfirmation,
      updatedAt: Instant,
  ): F[Boolean] = MonadCancelThrow[F].uncancelable { _ =>
    // Once the match is visible, either the draft transition or its compensation must finish.
    createMatch(record) >>
      matchDrafts.markConfirmedIfSnapshotMatches(expected, record.id, updatedAt).flatTap {
        case true => MonadCancelThrow[F].unit
        case false => matches.delete(record.id).void
      }
  }
