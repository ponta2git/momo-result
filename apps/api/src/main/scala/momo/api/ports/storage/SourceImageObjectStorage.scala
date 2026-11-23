package momo.api.ports.storage

import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

import fs2.Chunk

import momo.api.domain.ids.ImageId
import momo.api.util.Sha256

final case class SourceImageObjectKey private (value: String) derives CanEqual

object SourceImageObjectKey:
  private val MaxLength = 512
  private val SupportedExtensions = Set("png", "jpg", "webp")

  def fromString(value: String): Either[String, SourceImageObjectKey] =
    val segments = value.split("/", -1).toList
    Either.cond(
      value.nonEmpty && value.length <= MaxLength && !value.startsWith("/") &&
        !value.contains("://") && segments.forall(isSafeSegment),
      SourceImageObjectKey(value),
      "Object key must be an opaque, relative ASCII path of at most 512 characters.",
    )

  def forImage(imageId: ImageId, extension: String): Either[String, SourceImageObjectKey] =
    for
      safeExtension <- Either.cond(
        SupportedExtensions.contains(extension),
        extension,
        "Object key extension is not supported.",
      )
      shard = Sha256Hex.digest(imageId.value.getBytes(StandardCharsets.UTF_8)).value.take(2)
      key <- fromString(s"source-images/v1/$shard/${imageId.value}.$safeExtension")
    yield key

  private def isSafeSegment(value: String): Boolean = value.nonEmpty && value != "." &&
    value != ".." && value.forall(isSafeCharacter)

  private def isSafeCharacter(value: Char): Boolean =
    (value >= 'a' && value <= 'z') ||
      (value >= 'A' && value <= 'Z') ||
      (value >= '0' && value <= '9') || value == '-' || value == '_' || value == '.'

final case class Sha256Hex private (value: String) derives CanEqual

object Sha256Hex:
  def fromString(value: String): Either[String, Sha256Hex] = Either.cond(
    value.length == 64 && value.forall(character =>
      (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')
    ),
    Sha256Hex(value),
    "SHA-256 must be 64 lowercase hexadecimal characters.",
  )

  def digest(bytes: Array[Byte]): Sha256Hex = Sha256Hex(
    Sha256.hex(bytes)
  )

final case class SourceImageIdempotencyHash private (value: String) derives CanEqual

object SourceImageIdempotencyHash:
  def fromString(value: String): Either[String, SourceImageIdempotencyHash] = Either.cond(
    value.length == 64 && value.forall(character =>
      (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')
    ),
    SourceImageIdempotencyHash(value),
    "Source image idempotency hash must be 64 lowercase hexadecimal characters.",
  )

  def fromRawKey(value: String): SourceImageIdempotencyHash = digest(value)

  def uniqueFor(imageId: ImageId): SourceImageIdempotencyHash = digest(
    s"momo-source-image:${imageId.value}"
  )

  private def digest(value: String): SourceImageIdempotencyHash = SourceImageIdempotencyHash(
    Sha256.hexUtf8(value)
  )

final case class SourceImageObjectMetadata(
    key: SourceImageObjectKey,
    mediaType: String,
    sizeBytes: Long,
    sha256: Sha256Hex,
    etag: Option[String],
) derives CanEqual

/** The metadata and dimensions describe the owned bytes returned by this read. */
final class SourceImageObject private (
    val metadata: SourceImageObjectMetadata,
    val bytes: Chunk[Byte],
    private[api] val format: ImageValidation.ValidatedImage,
)

object SourceImageObject:
  def read(
      key: SourceImageObjectKey,
      input: InputStream,
      declared: Option[SourceImageObjectMetadata],
  ): Either[SourceImageObjectFailure, SourceImageObject] =
    val owned = input.readNBytes(ImageValidation.MaxBytes + 1)
    if declared.exists(m => m.key != key || m.sizeBytes != owned.length.toLong) then
      Left(SourceImageObjectFailure.IntegrityViolation)
    else
      ImageValidation.validate(owned, declared.map(_.mediaType))
        .left.map(_ => SourceImageObjectFailure.IntegrityViolation).flatMap { format =>
          val actual = SourceImageObjectMetadata(
            key,
            format.imageType.mediaType,
            owned.length.toLong,
            Sha256Hex.digest(owned),
            declared.flatMap(_.etag),
          )
          Either.cond(
            declared.forall(_ == actual),
            // The read owns this buffer. A read-only view keeps consumers from changing verified bytes.
            new SourceImageObject(
              actual,
              Chunk.byteBuffer(ByteBuffer.wrap(owned).asReadOnlyBuffer()),
              format
            ),
            SourceImageObjectFailure.IntegrityViolation,
          )
        }

enum SourceImageObjectFailure derives CanEqual:
  case NotFound
  case IntegrityViolation
  case AccessDenied
  case Unavailable

trait SourceImageObjectStorage[F[_]]:
  def put(
      key: SourceImageObjectKey,
      mediaType: String,
      bytes: Array[Byte],
      sha256: Sha256Hex,
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]]

  def head(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]]

  def get(key: SourceImageObjectKey): F[Either[SourceImageObjectFailure, SourceImageObject]]

  def delete(key: SourceImageObjectKey): F[Either[SourceImageObjectFailure, Unit]]

object SourceImageObjectStorage:
  /** Upload acceptance limit; existing metadata is restored without applying it. */
  val MaxUploadBytes = 3 * 1024 * 1024
