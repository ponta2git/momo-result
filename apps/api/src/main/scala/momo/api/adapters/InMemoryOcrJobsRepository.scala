package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.domain.ids.*
import momo.api.domain.{OcrFailure, OcrJob, OcrJobStatus}
import momo.api.repositories.OcrJobsRepository

final class InMemoryOcrJobsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, OcrJob]])
    extends OcrJobsRepository[F]:
  override def create(job: OcrJob): F[Unit] = ref.update(_ + (job.id.value -> job))

  override def find(jobId: OcrJobId): F[Option[OcrJob]] = ref.get.map(_.get(jobId.value))

  override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] = ref
    .update { jobs =>
      jobs.updatedWith(jobId.value)(_.map(job =>
        job.copy(
          status = OcrJobStatus.Failed,
          failure = Some(failure),
          finishedAt = Some(now),
          updatedAt = now,
        )
      ))
    }

  override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = ref.modify { jobs =>
    jobs.get(jobId.value) match
      case Some(job) if job.status == OcrJobStatus.Queued =>
        val updated = job
          .copy(status = OcrJobStatus.Cancelled, finishedAt = Some(now), updatedAt = now)
        jobs.updated(jobId.value, updated) -> true
      case _ => jobs -> false
  }

object InMemoryOcrJobsRepository:
  def create[F[_]: Sync]: F[InMemoryOcrJobsRepository[F]] = Ref
    .of[F, Map[String, OcrJob]](Map.empty).map(new InMemoryOcrJobsRepository(_))
