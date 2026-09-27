package momo.api.usecases.ocr

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.{AccountId, OcrJobId}
import momo.api.errors.AppError
import momo.api.repositories.{OcrJobCancellationResult, OcrJobsRepository}

final class CancelOcrJob[F[_]: Monad](jobs: OcrJobsRepository[F], now: F[Instant]):
  def run(jobId: OcrJobId, actorAccountId: AccountId): F[Either[AppError, Unit]] =
    now.flatMap { timestamp =>
      jobs.cancelQueuedOwned(jobId, actorAccountId, timestamp).map {
        case OcrJobCancellationResult.Cancelled => Right(())
        case OcrJobCancellationResult.NotFound => Left(AppError.NotFound("OCR job", jobId.value))
        case OcrJobCancellationResult.Forbidden =>
          Left(AppError.Forbidden("Only the creator can cancel this OCR job."))
        case OcrJobCancellationResult.NotQueued =>
          Left(AppError.Conflict("Only queued OCR jobs can be cancelled by the API."))
      }
    }
