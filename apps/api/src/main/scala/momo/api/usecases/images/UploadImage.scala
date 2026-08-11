package momo.api.usecases.images

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.StoredImage
import momo.api.domain.ids.AccountId
import momo.api.errors.AppError
import momo.api.ports.storage.{ImageStorage, SourceImageIdempotencyHash}

final class UploadImage[F[_]: Monad](
    imageStore: ImageStorage[F],
    admission: ImageStorageAdmission[F],
):
  def run(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = persist(
    ownerAccountId,
    fileName,
    contentType,
    bytes,
    idempotencyHash = None,
  )

  def runIdempotent(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
      idempotencyHash: SourceImageIdempotencyHash,
  ): F[Either[AppError, StoredImage]] = persist(
    ownerAccountId,
    fileName,
    contentType,
    bytes,
    Some(idempotencyHash),
  )

  private def persist(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
      idempotencyHash: Option[SourceImageIdempotencyHash],
  ): F[Either[AppError, StoredImage]] = admission
    .ensureCanAccept(ownerAccountId, bytes.length.toLong).flatMap {
      case Left(error) => error.asLeft[StoredImage].pure[F]
      case Right(_) => idempotencyHash match
          case Some(hash) =>
            imageStore.saveIdempotent(ownerAccountId, fileName, contentType, bytes, hash)
          case None => imageStore.save(ownerAccountId, fileName, contentType, bytes)
    }
