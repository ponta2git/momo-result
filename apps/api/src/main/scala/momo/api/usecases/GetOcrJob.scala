package momo.api.usecases

import cats.Functor

import momo.api.domain.OcrJob
import momo.api.domain.ids.OcrJobId
import momo.api.errors.AppError
import momo.api.repositories.OcrJobsRepository
import momo.api.usecases.syntax.UseCaseSyntax.*

final class GetOcrJob[F[_]: Functor](jobs: OcrJobsRepository[F]):
  def run(jobId: OcrJobId): F[Either[AppError, OcrJob]] = jobs.find(jobId)
    .orNotFound("ocr job", jobId.value).value
