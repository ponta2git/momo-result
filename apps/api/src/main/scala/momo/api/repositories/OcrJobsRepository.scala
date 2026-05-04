package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.OcrJobId
import momo.api.domain.{OcrFailure, OcrJob}

trait OcrJobsRepository[F[_]]:
  def create(job: OcrJob): F[Unit]
  def find(jobId: OcrJobId): F[Option[OcrJob]]
  def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit]
  def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean]
