package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{MatchDraftsRepository, OcrJobsRepository}
import momo.api.usecases.syntax.UseCaseSyntax.*

final class CancelMatchDraft[F[_]: MonadThrow](
    matchDrafts: MatchDraftsRepository[F],
    ocrJobs: OcrJobsRepository[F],
    sourceImageRetention: PurgeSourceImages[F],
    now: F[Instant],
):
  private val cancellableStatuses = Set(
    MatchDraftStatus.OcrRunning,
    MatchDraftStatus.OcrFailed,
    MatchDraftStatus.DraftReady,
    MatchDraftStatus.NeedsReview,
  )

  def run(draftId: MatchDraftId, accountId: AccountId): F[Either[AppError, Unit]] = (for
    draft <- matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
    _ <- EitherT.fromEither[F](authorize(draft.createdByAccountId, accountId))
    _ <- EitherT.fromEither[F](canCancel(draft.status))
    at <- EitherT.liftF(now)
    _ <- EitherT.liftF(ocrJobs.cancelQueuedByDraftIds(draft.ocrDraftIds, at))
    _ <- EitherT.liftF(sourceImageRetention.runBestEffort(draftId, at))
    _ <- matchDrafts.cancel(draftId, at).ensureF(AppError.Conflict(
      "match draft was changed to a terminal status before it could be deleted."
    ))
  yield ()).value

  private def authorize(
      createdByAccountId: AccountId,
      accountId: AccountId,
  ): Either[AppError, Unit] = Either.cond(
    createdByAccountId == accountId,
    (),
    AppError.Forbidden("You cannot cancel this match draft."),
  )

  private def canCancel(status: MatchDraftStatus): Either[AppError, Unit] = Either.cond(
    cancellableStatuses.contains(status),
    (),
    AppError.Conflict(s"match draft in status=${status.wire} cannot be cancelled."),
  )
