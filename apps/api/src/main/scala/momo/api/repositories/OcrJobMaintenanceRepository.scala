package momo.api.repositories

import java.time.Instant

trait OcrJobMaintenanceRepository[F[_]]:
  def failStaleJobs(now: Instant, staleBefore: Instant): F[Int]
