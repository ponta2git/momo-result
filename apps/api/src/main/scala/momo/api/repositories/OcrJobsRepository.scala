package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.JobId
import momo.api.domain.{OcrFailure, OcrJob}

trait OcrJobsRepository[F[_]]:
  def create(job: OcrJob): F[Unit]
  def find(jobId: JobId): F[Option[OcrJob]]
  def markFailed(jobId: JobId, failure: OcrFailure, now: Instant): F[Unit]
  def cancelQueued(jobId: JobId, now: Instant): F[Boolean]
