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

trait ImageStorageInspector[F[_]]:
  def unreferencedUsage(ownerAccountId: AccountId, referenced: Set[ImageId]): F[ImageStorageUsage]
  def diskUsage: F[ImageDiskUsage]

trait ImageOrphanCleaner[F[_]]:
  def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int]
