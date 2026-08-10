package momo.api.repositories

import java.time.Instant

final case class SeriesAnalysisQueueOutboxRecord(
    id: String,
    jobId: String,
    attemptCount: Int,
    claimExpiresAt: Instant,
)

final case class SeriesAnalysisCleanupCounts(
    operations: Int,
    requests: Int,
    jobs: Int,
    stagingArtifacts: Int,
    obsoleteArtifacts: Int,
):
  def total: Int = operations + requests + jobs + stagingArtifacts + obsoleteArtifacts

trait SeriesAnalysisQueueOutboxRepository[F[_]]:
  def expandPendingCampaignTargets(now: Instant, limit: Int): F[Int]
  def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): F[List[SeriesAnalysisQueueOutboxRecord]]
  def markDelivered(
      id: String,
      claimExpiresAt: Instant,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean]
  def releaseForRetry(
      id: String,
      claimExpiresAt: Instant,
      nextAttemptAt: Instant,
      safeErrorClass: String,
      now: Instant,
  ): F[Boolean]
  def reconcileQueued(
      now: Instant,
      redeliverBefore: Instant,
      limit: Int,
  ): F[Int]
  def cleanupHistory(
      terminalBefore: Instant,
      stagingBefore: Instant,
      limitPerTable: Int,
  ): F[SeriesAnalysisCleanupCounts]
