package momo.api.adapters

import java.time.Instant

import cats.Applicative

import momo.api.repositories.OcrJobMaintenanceRepository

final class InMemoryOcrJobMaintenanceRepository[F[_]: Applicative]
    extends OcrJobMaintenanceRepository[F]:
  override def failStaleJobs(now: Instant, staleBefore: Instant): F[Int] = Applicative[F].pure(0)
