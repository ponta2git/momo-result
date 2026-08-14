package momo.api.adapters.storage.objectstore

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import fs2.Stream
import org.slf4j.LoggerFactory

import momo.api.adapters.storage.ImageValidation
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.domain.{StoredImage, StoredImageLocation}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.*
import momo.api.repositories.*

final class ObjectBackedImageStore[F[_]: Async](
    sourceImages: SourceImagesRepository[F],
    objects: SourceImageObjectStorage[F],
    nextImageId: F[ImageId],
    now: F[Instant],
    quota: SourceImageQuota,
) extends ImageStorage[F]:
  import ObjectBackedImageStore.*

  private val logger = LoggerFactory.getLogger("momo.api.adapters.storage.ObjectBackedImageStore")

  override def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = saveValidated(
    ownerAccountId,
    contentType,
    bytes,
    idempotencyHash = None,
  )

  override def saveIdempotent(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
      idempotencyHash: SourceImageIdempotencyHash,
  ): F[Either[AppError, StoredImage]] = saveValidated(
    ownerAccountId,
    contentType,
    bytes,
    Some(idempotencyHash),
  )

  override def find(imageId: ImageId): F[Option[StoredImage]] = sourceImages.find(imageId).flatMap {
    case Some(record) if record.status == SourceImageStatus.Available =>
      storedImage(record).leftMap(AppException(_)).liftTo[F].map(Some(_))
    case _ => Async[F].pure(None)
  }

  override def readStream(image: StoredImage): Stream[F, Byte] = Stream.eval(read(image)).flatMap {
    case Right(bytes) => Stream.emits(bytes).covary[F]
    case Left(error) => Stream.raiseError[F](AppException(error))
  }

  override def delete(imageId: ImageId): F[Boolean] = now.flatMap(timestamp =>
    sourceImages.beginDeleteUnreferenced(imageId, timestamp).flatMap {
      case SourceImageDeleteResult.Pending(record) => deletePending(record)
      case SourceImageDeleteResult.Missing | SourceImageDeleteResult.AlreadyDeleted =>
        Async[F].pure(false)
      case SourceImageDeleteResult.NotReady(_) => Async[F].pure(false)
    }
  )

  private def saveValidated(
      ownerAccountId: AccountId,
      contentType: Option[String],
      bytes: Array[Byte],
      idempotencyHash: Option[SourceImageIdempotencyHash],
  ): F[Either[AppError, StoredImage]] = ImageValidation.validate(bytes, contentType) match
    case Left(error) => Async[F].pure(Left(error))
    case Right(validated) => nextImageId.flatMap { imageId =>
        SourceImageObjectKey.forImage(imageId, validated.imageType.extension) match
          case Left(_) => Async[F].pure(Left(InternalContractError))
          case Right(objectKey) => now.flatMap { timestamp =>
              val reservation = SourceImageReservation(
                id = imageId,
                ownerAccountId = ownerAccountId,
                objectKey = objectKey,
                idempotencyKeyHash = idempotencyHash
                  .getOrElse(SourceImageIdempotencyHash.uniqueFor(imageId)),
                mediaType = validated.imageType.mediaType,
                sizeBytes = bytes.length.toLong,
                sha256 = Sha256Hex.digest(bytes),
                width = validated.dimensions.width.toInt,
                height = validated.dimensions.height.toInt,
                now = timestamp,
              )
              sourceImages.reserveWithinQuota(reservation, quota).flatMap {
                case SourceImageReservationResult.Reserved(record) =>
                  uploadReserved(record, bytes)
                case SourceImageReservationResult.Existing(record) =>
                  resolveExisting(record, reservation, bytes)
                case SourceImageReservationResult.Rejected(rejection) => Async[F]
                    .delay(logger.warn(
                      s"image_upload_admission rejected accountId=${ownerAccountId.value} ${rejection
                          .logFields}"
                    )).as(Left(QuotaExceeded))
              }
            }
      }

  private def resolveExisting(
      record: SourceImageRecord,
      reservation: SourceImageReservation,
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] =
    if !samePayload(record, reservation) then
      Async[F].pure(Left(
        AppError.IdempotencyPayloadMismatch(
          "Idempotency-Key was reused with a different image payload."
        )
      ))
    else
      record.status match
        case SourceImageStatus.Available => Async[F].pure(storedImage(record))
        case SourceImageStatus.Reserved => Async[F].pure(Left(
            AppError.IdempotencyInProgress("Image upload is already processing. Retry later.")
          ))
        case SourceImageStatus.Failed => reclaimFailed(record, bytes)
        case SourceImageStatus.DeletePending | SourceImageStatus.Deleted => Async[F].pure(Left(
            AppError.Conflict("This Idempotency-Key belongs to an image that is being deleted.")
          ))

  private def reclaimFailed(
      record: SourceImageRecord,
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = now.flatMap(timestamp =>
    sourceImages.retryFailed(record.id, timestamp).flatMap {
      case true => uploadReserved(record.copy(status = SourceImageStatus.Reserved), bytes)
      case false => resolveAfterLostTransition(record.id)
    }
  )

  private def resolveAfterLostTransition(
      imageId: ImageId
  ): F[Either[AppError, StoredImage]] = sourceImages.find(imageId).flatMap {
    case Some(record) if record.status == SourceImageStatus.Available =>
      Async[F].pure(storedImage(record))
    case Some(record) if record.status == SourceImageStatus.Reserved =>
      Async[F].pure(Left(
        AppError.IdempotencyInProgress("Image upload is already processing. Retry later.")
      ))
    case _ => Async[F].pure(Left(StorageUnavailable))
  }

  private def uploadReserved(
      record: SourceImageRecord,
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = SourceImageIntegrity.expected(record) match
    case None => Async[F].pure(Left(InternalContractError))
    case Some(expected) => objects
        .put(record.objectKey, expected.mediaType, bytes, expected.sha256).flatMap {
          case Right(metadata) if SourceImageIntegrity.metadataMatches(expected, metadata) =>
            completeUpload(record, metadata.etag)
          case Right(_) => failUpload(record.id, SourceImageFailureCode.ObjectIntegrityViolation)
          case Left(SourceImageObjectFailure.IntegrityViolation) =>
            failUpload(record.id, SourceImageFailureCode.ObjectIntegrityViolation)
          case Left(_) => failUpload(record.id, SourceImageFailureCode.ObjectPutUnavailable)
        }

  private def completeUpload(
      record: SourceImageRecord,
      storageEtag: Option[String],
  ): F[Either[AppError, StoredImage]] = now.flatMap(timestamp =>
    sourceImages.markAvailable(record.id, storageEtag, timestamp).flatMap {
      case true => Async[F].pure(storedImage(record.copy(
          status = SourceImageStatus.Available,
          storageEtag = storageEtag,
          availableAt = Some(timestamp),
          updatedAt = timestamp,
        )))
      case false => resolveAfterLostTransition(record.id)
    }
  )

  private def failUpload(
      imageId: ImageId,
      failureCode: SourceImageFailureCode,
  ): F[Either[AppError, StoredImage]] = now.flatMap(timestamp =>
    sourceImages.markUploadFailed(imageId, failureCode, timestamp).as(Left(StorageUnavailable))
  )

  private def read(image: StoredImage): F[Either[AppError, Array[Byte]]] = sourceImages
    .find(image.imageId).flatMap {
      case None => Async[F].pure(Left(AppError.NotFound("source image", image.imageId.value)))
      case Some(record) if record.status != SourceImageStatus.Available =>
        Async[F].pure(Left(AppError.NotFound("source image", image.imageId.value)))
      case Some(record) if image.location.value != record.objectKey.value =>
        Async[F].pure(Left(InternalContractError))
      case Some(record) => objects.get(record.objectKey).map {
          case Right(sourceObject) if SourceImageIntegrity.matches(record, sourceObject) =>
            Right(sourceObject.bytes)
          case Right(_) | Left(SourceImageObjectFailure.IntegrityViolation) =>
            Left(StorageIntegrityError)
          case Left(SourceImageObjectFailure.NotFound) =>
            Left(AppError.NotFound("source image", image.imageId.value))
          case Left(_) => Left(StorageUnavailable)
        }
    }

  private def deletePending(record: SourceImageRecord): F[Boolean] = objects
    .delete(record.objectKey).flatMap {
      case Right(_) => now.flatMap(timestamp =>
          sourceImages.markDeleted(record.id, timestamp).flatMap {
            case true => Async[F].pure(true)
            case false => sourceImages.find(record.id).flatMap {
                case Some(current) if current.status == SourceImageStatus.Deleted =>
                  Async[F].pure(true)
                case _ => Async[F].raiseError(AppException(StorageUnavailable))
              }
          }
        )
      case Left(_) => Async[F].raiseError(AppException(StorageUnavailable))
    }

object ObjectBackedImageStore:
  private val StorageUnavailable = AppError.ServiceUnavailable(
    "Image storage is temporarily unavailable. Try again later."
  )
  private val StorageIntegrityError = AppError.DependencyFailed(
    "Stored image integrity verification failed."
  )
  private val InternalContractError = AppError.Internal("Source image metadata is invalid.")
  private val QuotaExceeded = AppError.TooManyRequests(
    "Too many unprocessed image uploads. Start OCR or wait for old uploads to expire."
  )

  private def samePayload(
      record: SourceImageRecord,
      reservation: SourceImageReservation,
  ): Boolean = record.ownerAccountId == reservation.ownerAccountId &&
    record.mediaType.contains(reservation.mediaType) &&
    record.sizeBytes.contains(reservation.sizeBytes) &&
    record.sha256.contains(reservation.sha256) &&
    record.width.contains(reservation.width) && record.height.contains(reservation.height)

  private def storedImage(record: SourceImageRecord): Either[AppError, StoredImage] =
    SourceImageIntegrity.expected(record).toRight(InternalContractError).flatMap { expected =>
      StoredImageLocation.fromString(expected.key.value).leftMap(_ => InternalContractError)
        .map(location =>
          StoredImage(
            record.id,
            location,
            expected.mediaType,
            expected.sizeBytes,
            expected.sha256.value,
          )
        )
    }
