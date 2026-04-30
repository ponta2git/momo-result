package momo.api.repositories

import momo.api.domain.ids.ImageId
import momo.api.domain.StoredImage
import momo.api.errors.AppError

trait ImageStore[F[_]]:
  def save(
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]]
  def find(imageId: ImageId): F[Option[StoredImage]]
