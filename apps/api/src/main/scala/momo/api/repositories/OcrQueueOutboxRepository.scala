package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.OcrJobId

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
    payload: OcrQueuePayload,
    attemptCount: Int,
    claimExpiresAt: Instant,
)

final case class OcrQueueBacklogSnapshot(
    pendingCount: Long,
    inFlightCount: Long,
    expiredInFlightCount: Long,
    duePendingCount: Long,
    oldestDueNextAttemptAt: Option[Instant],
) derives CanEqual:
  def dueBacklogCount: Long = duePendingCount + expiredInFlightCount
  def activeBacklogCount: Long = pendingCount + inFlightCount

final case class OcrQueueOutboxDraft(
    id: String,
    jobId: OcrJobId,
    dedupeKey: String,
    payload: OcrQueuePayload,
    createdAt: Instant,
)

object OcrQueueOutboxDraft:
  def idForJob(jobId: OcrJobId): String = s"ocr-outbox-${jobId.value}"
  def dedupeKeyForJob(jobId: OcrJobId): String = s"ocr-job:${jobId.value}"

  def forJob(jobId: OcrJobId, payload: OcrQueuePayload, createdAt: Instant): OcrQueueOutboxDraft =
    OcrQueueOutboxDraft(
      id = idForJob(jobId),
      jobId = jobId,
      dedupeKey = dedupeKeyForJob(jobId),
      payload = payload,
      createdAt = createdAt,
    )

trait OcrQueueOutboxRepository[F[_]]:
  def claimById(id: String, now: Instant, claimUntil: Instant): F[Option[OcrQueueOutboxRecord]]
  def claimDue(limit: Int, now: Instant, claimUntil: Instant): F[List[OcrQueueOutboxRecord]]
  def backlogSnapshot(now: Instant): F[OcrQueueBacklogSnapshot]
  def markDelivered(
      id: String,
      claimExpiresAt: Instant,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean]
  def releaseForRetry(
      id: String,
      claimExpiresAt: Instant,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): F[Boolean]
