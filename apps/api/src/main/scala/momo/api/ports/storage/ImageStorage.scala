package momo.api.ports.storage

import java.time.Instant

import fs2.Stream

import momo.api.domain.StoredImage
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.errors.AppError

final case class ImageStorageUsage(fileCount: Int, sizeBytes: Long)

final case class ImageDiskUsage(totalBytes: Long, usableBytes: Long):
  def usedBytes: Long = (totalBytes - usableBytes).max(0L)

trait ImageStorage[F[_]]:
  def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]]

  def saveIdempotent(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
      idempotencyHash: SourceImageIdempotencyHash,
  ): F[Either[AppError, StoredImage]] =
    val _ = idempotencyHash
    save(ownerAccountId, fileName, contentType, bytes)

  def find(imageId: ImageId): F[Option[StoredImage]]

  def readStream(image: StoredImage): Stream[F, Byte]
  def delete(imageId: ImageId): F[Boolean]

/**
 * Best-effort physical-capacity probe used before external storage I/O.
 *
 * It cannot make account quotas atomic with a later save. DB-backed quota ownership therefore
 * belongs to [[momo.api.repositories.SourceImagesRepository.reserveWithinQuota]].
 */
trait ImageStorageCapacityInspector[F[_]]:
  def diskUsage: F[Option[ImageDiskUsage]]

/**
 * Standalone-filesystem inspection boundary.
 *
 * The caller supplies one reference snapshot; this interface is not used by DB-backed object
 * storage, whose SQL candidate/update transaction owns reference consistency.
 */
trait ImageStorageInspector[F[_]] extends ImageStorageCapacityInspector[F]:
  def unreferencedUsage(ownerAccountId: AccountId, referenced: Set[ImageId]): F[ImageStorageUsage]

/** Runs one bounded cleanup batch while owning its reference-consistency policy internally. */
trait ImageOrphanCleaner[F[_]]:
  def runOnce: F[Int]

/** Standalone-filesystem cleanup primitive driven by an explicit reference snapshot and cutoff. */
trait ReferenceAwareImageOrphanCleaner[F[_]]:
  def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int]
