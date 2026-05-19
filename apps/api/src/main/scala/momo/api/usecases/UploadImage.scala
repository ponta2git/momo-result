package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.StoredImage
import momo.api.domain.ids.AccountId
import momo.api.errors.AppError
import momo.api.repositories.ImageStore

final class UploadImage[F[_]: Monad](
    imageStore: ImageStore[F],
    admission: ImageStorageAdmission[F],
):
  def run(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = admission
    .ensureCanAccept(ownerAccountId, bytes.length.toLong).flatMap {
      case Left(error) => error.asLeft[StoredImage].pure[F]
      case Right(_) => imageStore.save(ownerAccountId, fileName, contentType, bytes)
    }
