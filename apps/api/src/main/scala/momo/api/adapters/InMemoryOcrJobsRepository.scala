package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.domain.ids.*
import momo.api.domain.{OcrFailure, OcrJob}
import momo.api.repositories.OcrJobsRepository

final class InMemoryOcrJobsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, OcrJob]])
    extends OcrJobsRepository[F]:
  override def create(job: OcrJob): F[Unit] = ref.update(_ + (job.id.value -> job))

  override def find(jobId: OcrJobId): F[Option[OcrJob]] = ref.get.map(_.get(jobId.value))

  override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] = ref
    .update(jobs => jobs.updatedWith(jobId.value)(_.map(toFailed(_, failure, now))))

  override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = ref.modify { jobs =>
    jobs.get(jobId.value) match
      case Some(q: OcrJob.Queued) =>
        val updated = OcrJob.Cancelled(
          id = q.id,
          draftId = q.draftId,
          imageId = q.imageId,
          imagePath = q.imagePath,
          requestedScreenType = q.requestedScreenType,
          attemptCount = q.attemptCount,
          cancelledFinishedAt = now,
          createdAt = q.createdAt,
          updatedAt = now,
        )
        jobs.updated(jobId.value, updated) -> true
      case _ => jobs -> false
  }

  private def toFailed(job: OcrJob, failure: OcrFailure, now: Instant): OcrJob.Failed = OcrJob
    .Failed(
      id = job.id,
      draftId = job.draftId,
      imageId = job.imageId,
      imagePath = job.imagePath,
      requestedScreenType = job.requestedScreenType,
      failedDetectedScreenType = job.detectedScreenType,
      attemptCount = job.attemptCount,
      failedWorkerId = job.workerId,
      failedFailure = failure,
      failedStartedAt = job.startedAt,
      failedFinishedAt = now,
      failedDurationMs = job.durationMs,
      createdAt = job.createdAt,
      updatedAt = now,
    )

object InMemoryOcrJobsRepository:
  def create[F[_]: Sync]: F[InMemoryOcrJobsRepository[F]] = Ref
    .of[F, Map[String, OcrJob]](Map.empty).map(new InMemoryOcrJobsRepository(_))
