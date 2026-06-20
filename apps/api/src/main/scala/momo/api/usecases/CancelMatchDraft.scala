package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{MatchDraftCancellationRepository, MatchDraftCancellationResult}

final class CancelMatchDraft[F[_]: MonadThrow](
    cancellation: MatchDraftCancellationRepository[F],
    sourceImageRetention: PurgeSourceImages[F],
    now: F[Instant],
):
  def run(draftId: MatchDraftId): F[Either[AppError, Unit]] = (for
    at <- EitherT.liftF(now)
    result <- EitherT.liftF(cancellation.cancelDraftAndQueuedOcrJobs(draftId, at))
    _ <- result match
      case MatchDraftCancellationResult.Cancelled(sourceImageIds) => EitherT
          .liftF(sourceImageRetention.deleteKnownBestEffort(draftId, sourceImageIds))
      case MatchDraftCancellationResult.NotFound => EitherT
          .leftT[F, Unit](AppError.NotFound("match draft", draftId.value))
      case MatchDraftCancellationResult.NotCancellable(status) => EitherT
          .leftT[F, Unit](notCancellable(status))
  yield ()).value

  private def notCancellable(status: MatchDraftStatus): AppError = AppError
    .Conflict(s"match draft in status=${status.wire} cannot be cancelled.")
