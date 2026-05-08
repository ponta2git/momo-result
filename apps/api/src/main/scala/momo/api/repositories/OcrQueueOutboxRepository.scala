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
)

final case class OcrQueueOutboxDraft(
    id: String,
    jobId: OcrJobId,
    dedupeKey: String,
    payload: OcrQueuePayload,
    createdAt: Instant,
)

object OcrQueueOutboxDraft:
  def forJob(jobId: OcrJobId, payload: OcrQueuePayload, createdAt: Instant): OcrQueueOutboxDraft =
    OcrQueueOutboxDraft(
      id = s"ocr-outbox-${jobId.value}",
      jobId = jobId,
      dedupeKey = s"ocr-job:${jobId.value}",
      payload = payload,
      createdAt = createdAt,
    )

trait OcrQueueOutboxRepository[F[_]]:
  def claimDue(limit: Int, now: Instant, claimUntil: Instant): F[List[OcrQueueOutboxRecord]]
  def markDelivered(id: String, redisMessageId: String, now: Instant): F[Unit]
  def releaseForRetry(id: String, lastError: String, nextAttemptAt: Instant, now: Instant): F[Unit]
