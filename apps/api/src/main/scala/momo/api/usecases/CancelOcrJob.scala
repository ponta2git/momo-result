package momo.api.usecases

import cats.syntax.all.*
import cats.Monad
import java.time.Instant
import momo.api.domain.ids.JobId
import momo.api.errors.AppError
import momo.api.repositories.OcrJobsRepository

final class CancelOcrJob[F[_]: Monad](jobs: OcrJobsRepository[F], now: F[Instant]):
  def run(jobId: String): F[Either[AppError, Unit]] = now.flatMap { timestamp =>
    jobs.cancelQueued(JobId(jobId), timestamp).map(cancelled =>
      Either
        .cond(cancelled, (), AppError.Conflict("Only queued OCR jobs can be cancelled by the API."))
    )
  }
