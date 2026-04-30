package momo.api.usecases

import momo.api.domain.StoredImage
import momo.api.errors.AppError
import momo.api.repositories.ImageStore

final class UploadImage[F[_]](imageStore: ImageStore[F]):
  def run(
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = imageStore.save(fileName, contentType, bytes)
