package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.domain.{OcrFailure, OcrJob}

trait OcrJobsAlg[F0[_]]:
  def create(job: OcrJob): F0[Unit]
  def find(jobId: OcrJobId): F0[Option[OcrJob]]
  def countActive: F0[Long]
  def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F0[Unit]
  def cancelQueued(jobId: OcrJobId, now: Instant): F0[Boolean]
  def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F0[Int]

trait OcrJobsRepository[F[_]]:
  def create(job: OcrJob): F[Unit]
  def find(jobId: OcrJobId): F[Option[OcrJob]]
  def countActive: F[Long]
  def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit]
  def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean]
  def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F[Int]

object OcrJobsRepository:
  def fromAlg[F0[_], F[_]](alg: OcrJobsAlg[F0], liftK: F0 ~> F): OcrJobsRepository[F] =
    new OcrJobsRepository[F]:
      def create(job: OcrJob): F[Unit] = liftK(alg.create(job))
      def find(jobId: OcrJobId): F[Option[OcrJob]] = liftK(alg.find(jobId))
      def countActive: F[Long] = liftK(alg.countActive)
      def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] =
        liftK(alg.markFailed(jobId, failure, now))
      def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] =
        liftK(alg.cancelQueued(jobId, now))
      def cancelQueuedByDraftIds(draftIds: List[OcrDraftId], now: Instant): F[Int] =
        liftK(alg.cancelQueuedByDraftIds(draftIds, now))

  def liftIdentity[F[_]](alg: OcrJobsAlg[F]): OcrJobsRepository[F] = new OcrJobsRepository[F]:
    export alg.*
end OcrJobsRepository
