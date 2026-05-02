package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.ids.MemberId
import momo.api.domain.MatchDraftStatus
import momo.api.errors.AppError
import momo.api.repositories.MatchDraftsRepository

final class CancelMatchDraft[F[_]: MonadThrow](
    matchDrafts: MatchDraftsRepository[F],
    sourceImageRetention: SourceImageRetentionService[F],
    now: F[Instant],
):
  private val cancellableStatuses = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

  def run(draftId: String, memberId: MemberId): F[Either[AppError, Unit]] = (for
    draft <-
      EitherT(matchDrafts.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId))))
    _ <- EitherT.fromEither[F](authorize(draft.createdByMemberId, memberId))
    _ <- EitherT.fromEither[F](canCancel(draft.status))
    at <- EitherT.liftF(now)
    cancelled <- EitherT.liftF(matchDrafts.cancel(draftId, at))
    _ <- EitherT
      .fromEither[F](Either.cond(cancelled, (), AppError.NotFound("match draft", draftId)))
    _ <- EitherT.liftF(sourceImageRetention.markForCleanup(draftId, at))
  yield ()).value

  private def authorize(createdByMemberId: String, memberId: MemberId): Either[AppError, Unit] =
    Either.cond(
      createdByMemberId == memberId.value,
      (),
      AppError.Forbidden("You cannot cancel this match draft."),
    )

  private def canCancel(status: MatchDraftStatus): Either[AppError, Unit] = Either.cond(
    cancellableStatuses.contains(status),
    (),
    AppError.Conflict(s"match draft in status=${status.wire} cannot be cancelled."),
  )
