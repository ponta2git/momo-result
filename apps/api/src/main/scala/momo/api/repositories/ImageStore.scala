package momo.api.repositories

import java.time.Instant

import momo.api.domain.StoredImage
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.errors.AppError

final case class ImageStorageUsage(fileCount: Int, sizeBytes: Long)

final case class ImageDiskUsage(totalBytes: Long, usableBytes: Long):
  def usedBytes: Long = (totalBytes - usableBytes).max(0L)

trait ImageStore[F[_]]:
  def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]]
  def find(imageId: ImageId): F[Option[StoredImage]]

  /**
   * Read the raw bytes of a previously-stored image. Implementations are responsible for shifting
   * any blocking I/O onto the appropriate execution context. Callers that have already verified
   * the image exists (e.g. via [[find]]) can rely on this raising `AppError.NotFound`-equivalent
   * errors when the underlying file vanishes.
   */
  def readBytes(image: StoredImage): F[Array[Byte]]
  def delete(imageId: ImageId): F[Boolean]

trait ImageStorageInspector[F[_]]:
  def unreferencedUsage(ownerAccountId: AccountId, referenced: Set[ImageId]): F[ImageStorageUsage]
  def diskUsage: F[ImageDiskUsage]

trait ImageOrphanStore[F[_]]:
  def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int]
