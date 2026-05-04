package momo.api.usecases

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.OcrJobId
import momo.api.errors.AppError
import momo.api.repositories.OcrJobsRepository

final class CancelOcrJob[F[_]: Monad](jobs: OcrJobsRepository[F], now: F[Instant]):
  def run(jobId: OcrJobId): F[Either[AppError, Unit]] = now.flatMap { timestamp =>
    jobs.cancelQueued(jobId, timestamp).map(cancelled =>
      Either
        .cond(cancelled, (), AppError.Conflict("Only queued OCR jobs can be cancelled by the API."))
    )
  }
