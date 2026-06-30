package momo.api.adapters.storage.local

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import momo.api.domain.ids.ImageId

private[storage] object LocalFsImageStoreSupport:
  val MaxBytes = 3 * 1024 * 1024
  val MaxWidth = 3840
  val MaxHeight = 2160
  val MaxDimensionsLabel = s"${MaxWidth.toString}x${MaxHeight.toString}"

  final case class ImageType(mediaType: String, extension: String)
  private[adapters] final case class ImageDimensions(width: Long, height: Long):
    def exceedsLimit: Boolean = width <= 0L || height <= 0L || width > MaxWidth.toLong ||
      height > MaxHeight.toLong

  val Png: ImageType = ImageType("image/png", "png")
  val Jpeg: ImageType = ImageType("image/jpeg", "jpg")
  val Webp: ImageType = ImageType("image/webp", "webp")
  val SupportedImageTypes: List[ImageType] = List(Png, Jpeg, Webp)

  private[adapters] def sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.getBytes(StandardCharsets.UTF_8)).map(byte => f"${byte & 0xff}%02x").mkString

  private[adapters] def safeImageFileStem(imageId: ImageId): Option[String] = Option
    .when(isSafeImageFileStem(imageId.value))(imageId.value)

  private[adapters] def isSafeImageFileStem(value: String): Boolean = value.nonEmpty &&
    value
      .forall(character => isAsciiLetterOrDigit(character) || character == '-' || character == '_')

  private def isAsciiLetterOrDigit(character: Char): Boolean =
    (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9')

  def normalizeMediaType(value: String): String = value.takeWhile(_ != ';').trim.toLowerCase

  def detect(bytes: Array[Byte]): Option[ImageType] = ImageFormatParsers.detect(bytes)

  private[adapters] def dimensions(
      bytes: Array[Byte],
      imageType: ImageType
  ): Option[ImageDimensions] = ImageFormatParsers.dimensions(bytes, imageType)
