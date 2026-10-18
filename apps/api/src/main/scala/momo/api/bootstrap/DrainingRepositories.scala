package momo.api.bootstrap

import cats.effect.Async
import cats.syntax.all.*
import doobie.Transactor
import doobie.implicits.*
import fs2.Stream

import momo.api.adapters.postgres.PostgresIdentities
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.domain.{OcrSubmission, StoredImage}
import momo.api.errors.AppError
import momo.api.maintenance.MaintenanceDrain
import momo.api.ports.storage.{ImageStorage, SourceImageIdempotencyHash}
import momo.api.repositories.OcrSubmissionsRepository
import momo.api.util.Sha256

/** Continuations must refer to a durable admission; closing the gate never extends its deadline. */
private[bootstrap] object DrainingRepositories:
  private val Unavailable = AppError.ServiceUnavailable("The service is undergoing maintenance.")

  def submissions[F[_]: Async](
      underlying: OcrSubmissionsRepository[F],
      maintenance: MaintenanceDrain[F],
  ): OcrSubmissionsRepository[F] = new OcrSubmissionsRepository[F]:
    override def find(id: String, owner: AccountId): F[Option[OcrSubmission]] =
      underlying.find(id, owner)

    override def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]] =
      maintenance.admissionOpen.flatMap {
        case true => underlying.put(submission)
        case false => Async[F].pure(Left(Unavailable))
      }

    override def failAdmission(
        owner: AccountId,
        keyHash: String,
        sha256: String,
        byteLength: Int
    ): F[Unit] =
      underlying.failAdmission(owner, keyHash, sha256, byteLength)

  def images[F[_]: Async](
      underlying: ImageStorage[F],
      maintenance: MaintenanceDrain[F],
      transactor: Transactor[F],
      identities: PostgresIdentities,
  ): ImageStorage[F] = new ImageStorage[F]:
    override def save(
        ownerAccountId: AccountId,
        fileName: Option[String],
        contentType: Option[String],
        bytes: Array[Byte],
    ): F[Either[AppError, StoredImage]] = maintenance.admissionOpen.flatMap {
      case true => underlying.save(ownerAccountId, fileName, contentType, bytes)
      case false => Async[F].pure(Left(Unavailable))
    }

    override def saveIdempotent(
        ownerAccountId: AccountId,
        fileName: Option[String],
        contentType: Option[String],
        bytes: Array[Byte],
        idempotencyHash: SourceImageIdempotencyHash,
    ): F[Either[AppError, StoredImage]] = maintenance.admissionOpen.flatMap { open =>
      val permitted =
        if open then Async[F].pure(true)
        else
          val digest = Sha256.hex(bytes)
          sql"""SELECT EXISTS (
            SELECT 1 FROM ocr_submissions s
            JOIN ocr_submission_members m ON m.submission_id = s.id
            WHERE s.owner_account_id = ${identities.accountReference(
              ownerAccountId.value
            )} AND s.status = 'open'
              AND s.admission_deadline > clock_timestamp() AND m.status = 'pending'
              AND m.upload_idempotency_key_hash = ${idempotencyHash.value}
              AND m.image_sha256_hex = $digest AND m.image_byte_length = ${bytes.length}
          )""".query[Boolean].unique.transact(transactor)
      permitted.flatMap {
        case true =>
          underlying.saveIdempotent(ownerAccountId, fileName, contentType, bytes, idempotencyHash)
        case false => Async[F].pure(Left(Unavailable))
      }
    }

    override def find(imageId: ImageId): F[Option[StoredImage]] = underlying.find(imageId)
    override def readStream(image: StoredImage): Stream[F, Byte] = underlying.readStream(image)
    override def delete(imageId: ImageId): F[Boolean] = underlying.delete(imageId)
