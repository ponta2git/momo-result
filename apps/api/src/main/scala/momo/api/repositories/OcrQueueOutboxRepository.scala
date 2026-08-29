package momo.api.repositories

import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.FiniteDuration

import momo.api.domain.ids.OcrJobId
import momo.api.ports.queue.OcrJobEnqueueRequest

enum OcrQueueOutboxStatus(val wire: String) derives CanEqual:
  case Pending extends OcrQueueOutboxStatus("PENDING")
  case InFlight extends OcrQueueOutboxStatus("IN_FLIGHT")
  case Delivered extends OcrQueueOutboxStatus("DELIVERED")
  case Failed extends OcrQueueOutboxStatus("FAILED")

object OcrQueueOutboxStatus:
  def fromWire(value: String): Option[OcrQueueOutboxStatus] = values.find(_.wire == value)

final case class OcrQueueOutboxRecord(
    id: String,
    jobId: OcrJobId,
    enqueueRequest: OcrJobEnqueueRequest,
    attemptCount: Int,
    claimToken: UUID,
    claimExpiresAt: Instant,
)

final case class InvalidOcrQueueOutboxClaim(
    id: String,
    jobId: OcrJobId,
    claimToken: UUID,
) derives CanEqual

enum OcrQueueOutboxClaim derives CanEqual:
  case Publish(record: OcrQueueOutboxRecord)
  case Invalid(claim: InvalidOcrQueueOutboxClaim)

final case class OcrQueueBacklogSnapshot(
    pendingCount: Long,
    inFlightCount: Long,
    expiredInFlightCount: Long,
    duePendingCount: Long,
    oldestDueNextAttemptAt: Option[Instant],
    recoverableInvalidCount: Long,
) derives CanEqual:
  def dueBacklogCount: Long = duePendingCount + expiredInFlightCount + recoverableInvalidCount
  def activeBacklogCount: Long = pendingCount + inFlightCount + recoverableInvalidCount

final case class OcrQueueOutboxDraft(
    id: String,
    jobId: OcrJobId,
    dedupeKey: String,
    enqueueRequest: OcrJobEnqueueRequest,
    createdAt: Instant,
)

object OcrQueueOutboxDraft:
  def idForJob(jobId: OcrJobId): String = s"ocr-outbox-${jobId.value}"
  def dedupeKeyForJob(jobId: OcrJobId): String = s"ocr-job:${jobId.value}"

  def forJob(
      jobId: OcrJobId,
      enqueueRequest: OcrJobEnqueueRequest,
      createdAt: Instant,
  ): OcrQueueOutboxDraft =
    OcrQueueOutboxDraft(
      id = idForJob(jobId),
      jobId = jobId,
      dedupeKey = dedupeKeyForJob(jobId),
      enqueueRequest = enqueueRequest,
      createdAt = createdAt,
    )

trait OcrQueueOutboxRepository[F[_]]:
  def claimDue(limit: Int, now: Instant, claimUntil: Instant): F[List[OcrQueueOutboxClaim]]
  def failInvalidClaim(claim: InvalidOcrQueueOutboxClaim, now: Instant): F[Boolean]
  def rearmQueuedForRedelivery(now: Instant, redeliverBefore: Instant, limit: Int): F[Int]
  def nextWakeAt(now: Instant, redeliveryAfter: FiniteDuration): F[Option[Instant]]
  def backlogSnapshot(now: Instant): F[OcrQueueBacklogSnapshot]
  def markDelivered(
      id: String,
      claimToken: UUID,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean]
  def releaseForRetry(
      id: String,
      claimToken: UUID,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): F[Boolean]
