package momo.api.usecases

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.OcrJob
import momo.api.domain.ids.OcrJobId
import momo.api.errors.AppError
import momo.api.repositories.OcrJobsRepository

final class GetOcrJob[F[_]: Functor](jobs: OcrJobsRepository[F]):
  def run(jobId: OcrJobId): F[Either[AppError, OcrJob]] = jobs.find(jobId)
    .map(_.toRight(AppError.NotFound("ocr job", jobId.value)))
