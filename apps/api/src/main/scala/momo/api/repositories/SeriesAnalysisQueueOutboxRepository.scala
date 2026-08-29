package momo.api.repositories

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

final case class SeriesAnalysisQueueOutboxRecord(
    id: String,
    jobId: String,
    attemptCount: Int,
    claimExpiresAt: Instant,
):
  require(
    (0 until 3).contains(attemptCount),
    "analysis outbox claim attemptCount must be between 0 and 2",
  )

  def exhaustsDeliveryAttempts: Boolean = attemptCount == 2

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
      claim: SeriesAnalysisQueueOutboxRecord,
      nextAttemptAt: Instant,
      redeliverBefore: Instant,
      now: Instant,
  ): F[Boolean]
  def reconcileQueued(
      now: Instant,
      redeliverBefore: Instant,
      limit: Int,
  ): F[Int]
  def nextWakeAt(now: Instant, redeliveryAfter: FiniteDuration): F[Option[Instant]]
  def cleanupHistory(
      terminalBefore: Instant,
      stagingBefore: Instant,
      limitPerTable: Int,
  ): F[SeriesAnalysisCleanupCounts]
