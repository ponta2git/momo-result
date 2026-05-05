package momo.api.repositories

import momo.api.domain.StoredImage
import momo.api.domain.ids.ImageId
import momo.api.errors.AppError

trait ImageStore[F[_]]:
  def save(
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
