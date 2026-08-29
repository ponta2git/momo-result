package momo.api.repositories

import java.time.Instant

final case class SeriesAnalysisCleanupCounts(
    operations: Int,
    requests: Int,
    jobs: Int,
    stagingArtifacts: Int,
    obsoleteArtifacts: Int,
):
  def total: Int = operations + requests + jobs + stagingArtifacts + obsoleteArtifacts

trait SeriesAnalysisHistoryMaintenance[F[_]]:
  def cleanupHistory(
      terminalBefore: Instant,
      stagingBefore: Instant,
      limitPerTable: Int,
  ): F[SeriesAnalysisCleanupCounts]
