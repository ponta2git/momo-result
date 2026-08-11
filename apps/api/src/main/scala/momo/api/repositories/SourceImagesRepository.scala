package momo.api.repositories

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectKey}

final case class SourceImageIdempotencyHash private (value: String) derives CanEqual

object SourceImageIdempotencyHash:
  def fromString(value: String): Either[String, SourceImageIdempotencyHash] = Either.cond(
    value.length == 64 && value.forall(character =>
      (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')
    ),
    SourceImageIdempotencyHash(value),
    "Source image idempotency hash must be 64 lowercase hexadecimal characters.",
  )

  def fromRawKey(value: String): SourceImageIdempotencyHash = digest(value)

  def uniqueFor(imageId: ImageId): SourceImageIdempotencyHash = digest(
    s"momo-source-image:${imageId.value}"
  )

  private def digest(value: String): SourceImageIdempotencyHash = SourceImageIdempotencyHash(
    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))
      .map(byte => f"${byte & 0xff}%02x").mkString
  )

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

enum SourceImageReservationResult derives CanEqual:
  case Reserved(image: SourceImageRecord)
  case Existing(image: SourceImageRecord)

enum SourceImageDeleteResult derives CanEqual:
  case Pending(image: SourceImageRecord)
  case Missing
  case AlreadyDeleted
  case NotReady(status: SourceImageStatus)

trait SourceImagesRepository[F[_]]:
  def reserve(reservation: SourceImageReservation): F[SourceImageReservationResult]
  def find(id: ImageId): F[Option[SourceImageRecord]]
  def markAvailable(id: ImageId, storageEtag: Option[String], now: Instant): F[Boolean]
  def markUploadFailed(id: ImageId, failureCode: SourceImageFailureCode, now: Instant): F[Boolean]
  def retryFailed(id: ImageId, now: Instant): F[Boolean]
  def beginDelete(id: ImageId, now: Instant): F[SourceImageDeleteResult]
  def markDeleted(id: ImageId, now: Instant): F[Boolean]
  def reconciliationCandidates(olderThan: Instant, limit: Int): F[List[SourceImageRecord]]
