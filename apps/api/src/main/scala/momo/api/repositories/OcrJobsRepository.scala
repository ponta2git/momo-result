package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.OcrJobId
import momo.api.domain.{OcrFailure, OcrJob}

trait OcrJobsAlg[F0[_]]:
  def create(job: OcrJob): F0[Unit]
  def find(jobId: OcrJobId): F0[Option[OcrJob]]
  def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F0[Unit]
  def cancelQueued(jobId: OcrJobId, now: Instant): F0[Boolean]

trait OcrJobsRepository[F[_]]:
  def create(job: OcrJob): F[Unit]
  def find(jobId: OcrJobId): F[Option[OcrJob]]
  def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit]
  def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean]

object OcrJobsRepository:
  def fromConnectionIO[F[_]](
      alg: OcrJobsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): OcrJobsRepository[F] = new OcrJobsRepository[F]:
    def create(job: OcrJob): F[Unit] = transactK(alg.create(job))
    def find(jobId: OcrJobId): F[Option[OcrJob]] = transactK(alg.find(jobId))
    def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] =
      transactK(alg.markFailed(jobId, failure, now))
    def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] =
      transactK(alg.cancelQueued(jobId, now))

  def liftIdentity[F[_]](alg: OcrJobsAlg[F]): OcrJobsRepository[F] = new OcrJobsRepository[F]:
    def create(job: OcrJob): F[Unit] = alg.create(job)
    def find(jobId: OcrJobId): F[Option[OcrJob]] = alg.find(jobId)
    def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] = alg
      .markFailed(jobId, failure, now)
    def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = alg.cancelQueued(jobId, now)
end OcrJobsRepository
