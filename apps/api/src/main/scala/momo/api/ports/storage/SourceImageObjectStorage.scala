package momo.api.ports.storage

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import momo.api.domain.ids.ImageId

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
    MessageDigest.getInstance("SHA-256").digest(bytes).map(byte => f"${byte & 0xff}%02x").mkString
  )

final case class SourceImageObjectMetadata(
    key: SourceImageObjectKey,
    mediaType: String,
    sizeBytes: Long,
    sha256: Sha256Hex,
    etag: Option[String],
) derives CanEqual

final case class SourceImageObject(metadata: SourceImageObjectMetadata, bytes: Array[Byte])

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
