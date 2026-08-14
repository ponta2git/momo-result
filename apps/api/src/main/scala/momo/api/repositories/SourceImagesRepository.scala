package momo.api.repositories

import java.time.Instant

import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}

enum SourceImageStatus(val wire: String) derives CanEqual:
  case Reserved extends SourceImageStatus("RESERVED")
  case Available extends SourceImageStatus("AVAILABLE")
  case DeletePending extends SourceImageStatus("DELETE_PENDING")
  case Deleted extends SourceImageStatus("DELETED")
  case Failed extends SourceImageStatus("FAILED")

object SourceImageStatus:
  def fromWire(value: String): Either[String, SourceImageStatus] = values.find(_.wire == value)
    .toRight(s"unknown source image status=$value")

enum SourceImageFailureCode(val wire: String) derives CanEqual:
  case ObjectPutUnavailable extends SourceImageFailureCode("OBJECT_PUT_UNAVAILABLE")
  case ObjectIntegrityViolation extends SourceImageFailureCode("OBJECT_INTEGRITY_VIOLATION")
  case ObjectMissing extends SourceImageFailureCode("OBJECT_MISSING")

object SourceImageFailureCode:
  def fromWire(value: String): Either[String, SourceImageFailureCode] = values.find(_.wire == value)
    .toRight(s"unknown source image failure code=$value")

final case class SourceImageRecord(
    id: ImageId,
    ownerAccountId: AccountId,
    objectKey: SourceImageObjectKey,
    idempotencyKeyHash: SourceImageIdempotencyHash,
    status: SourceImageStatus,
    mediaType: Option[String],
    sizeBytes: Option[Long],
    sha256: Option[Sha256Hex],
    width: Option[Int],
    height: Option[Int],
    storageEtag: Option[String],
    failureCode: Option[SourceImageFailureCode],
    availableAt: Option[Instant],
    deletePendingAt: Option[Instant],
    deletedAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant,
) derives CanEqual

final case class SourceImageReservation(
    id: ImageId,
    ownerAccountId: AccountId,
    objectKey: SourceImageObjectKey,
    idempotencyKeyHash: SourceImageIdempotencyHash,
    mediaType: String,
    sizeBytes: Long,
    sha256: Sha256Hex,
    width: Int,
    height: Int,
    now: Instant,
) derives CanEqual

final case class SourceImageQuota(
    unreferencedCountLimit: Int,
    unreferencedBytesLimit: Long,
) derives CanEqual

enum SourceImageQuotaRejection derives CanEqual:
  case CountExceeded(countAfter: Long, limit: Int)
  case BytesExceeded(bytesAfter: Long, limit: Long)

  def logFields: String = this match
    case CountExceeded(countAfter, limit) =>
      s"reason=unreferenced_count_exceeded countAfter=$countAfter limit=$limit"
    case BytesExceeded(bytesAfter, limit) =>
      s"reason=unreferenced_bytes_exceeded bytesAfter=$bytesAfter limit=$limit"

enum SourceImageReservationResult derives CanEqual:
  case Reserved(image: SourceImageRecord)
  case Existing(image: SourceImageRecord)
  case Rejected(rejection: SourceImageQuotaRejection)

enum SourceImageDeleteResult derives CanEqual:
  case Pending(image: SourceImageRecord)
  case Missing
  case AlreadyDeleted
  case NotReady(status: SourceImageStatus)

trait SourceImagesRepository[F[_]]:
  /**
   * Atomically applies the account quota and reserves a new image.
   *
   * Existing idempotency keys are returned before quota evaluation, so a retry never consumes a
   * second slot. Implementations must serialize this decision per account across runtime replicas.
   */
  def reserveWithinQuota(
      reservation: SourceImageReservation,
      quota: SourceImageQuota,
  ): F[SourceImageReservationResult]
  def find(id: ImageId): F[Option[SourceImageRecord]]
  def markAvailable(id: ImageId, storageEtag: Option[String], now: Instant): F[Boolean]
  def markUploadFailed(id: ImageId, failureCode: SourceImageFailureCode, now: Instant): F[Boolean]
  def retryFailed(id: ImageId, now: Instant): F[Boolean]

  /**
   * Claims exclusive ownership of purging an old FAILED object.
   *
   * The claim must race atomically with [[retryFailed]]. A stale claim may be taken over after
   * `claimStaleBefore`; callers complete only the exact claim timestamp returned here.
   */
  def claimFailedPurge(
      id: ImageId,
      olderThan: Instant,
      claimStaleBefore: Instant,
      claimedAt: Instant,
  ): F[Option[SourceImageRecord]]
  def purgeClaimedFailed(id: ImageId, claimedAt: Instant): F[Boolean]

  /** Atomically transitions an AVAILABLE image only when no live OCR/draft reference exists. */
  def beginDeleteUnreferenced(id: ImageId, now: Instant): F[SourceImageDeleteResult]
  def markDeleted(id: ImageId, now: Instant): F[Boolean]
  def reconciliationCandidates(olderThan: Instant, limit: Int): F[List[SourceImageRecord]]
  def orphanCandidates(olderThan: Instant, limit: Int): F[List[SourceImageRecord]]
