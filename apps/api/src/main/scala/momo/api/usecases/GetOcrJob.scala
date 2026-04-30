package momo.api.usecases

import cats.syntax.all.*
import cats.Functor
import momo.api.domain.ids.JobId
import momo.api.domain.OcrJob
import momo.api.errors.AppError
import momo.api.repositories.OcrJobsRepository

final class GetOcrJob[F[_]: Functor](jobs: OcrJobsRepository[F]):
  def run(jobId: String): F[Either[AppError, OcrJob]] = jobs.find(JobId(jobId))
    .map(_.toRight(AppError.NotFound("ocr job", jobId)))
