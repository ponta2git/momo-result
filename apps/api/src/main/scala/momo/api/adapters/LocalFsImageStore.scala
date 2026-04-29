package momo.api.adapters

import cats.effect.Sync
import cats.syntax.all.*
import momo.api.domain.StoredImage
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.ImageStore

import java.nio.file.Files
import java.nio.file.Path

final class LocalFsImageStore[F[_]: Sync](root: Path) extends ImageStore[F]:
  import LocalFsImageStore.*

  override def save(
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte]
  ): F[Either[AppError, StoredImage]] =
    validate(bytes, contentType).traverse { imageType =>
      for
        id <- momo.api.domain.IdGenerator.uuidV7[F].map(ImageId(_))
        _ <- Sync[F].blocking(Files.createDirectories(root))
        path = root.resolve(s"${id.value}.${imageType.extension}").toAbsolutePath.normalize()
        _ <- Sync[F].blocking(Files.write(path, bytes))
      yield StoredImage(id, path, imageType.mediaType, bytes.length.toLong)
    }

  override def find(imageId: ImageId): F[Option[StoredImage]] =
    Sync[F].blocking {
      SupportedImageTypes
        .to(LazyList)
        .flatMap { imageType =>
          val path =
            root.resolve(s"${imageId.value}.${imageType.extension}").toAbsolutePath.normalize()
          Option.when(Files.exists(path))(
            StoredImage(imageId, path, imageType.mediaType, Files.size(path))
          )
        }
        .headOption
    }

  private def validate(
      bytes: Array[Byte],
      contentType: Option[String]
  ): Either[AppError, ImageType] =
    if bytes.length > MaxBytes then
      Left(AppError.PayloadTooLarge(s"Image must be ${MaxBytes.toString} bytes or smaller."))
    else
      val detected = detect(bytes)
      detected match
        case None =>
          Left(AppError.UnsupportedMediaType("Only PNG, JPEG, and WebP images are supported."))
        case Some(imageType)
            if contentType.exists(ct => normalizeMediaType(ct) != imageType.mediaType) =>
          Left(AppError.UnsupportedMediaType("Content-Type does not match the image bytes."))
        case Some(imageType) =>
          Right(imageType)

object LocalFsImageStore:
  val MaxBytes = 500 * 1024

  final case class ImageType(mediaType: String, extension: String)

  val Png: ImageType = ImageType("image/png", "png")
  val Jpeg: ImageType = ImageType("image/jpeg", "jpg")
  val Webp: ImageType = ImageType("image/webp", "webp")
  val SupportedImageTypes: List[ImageType] = List(Png, Jpeg, Webp)

  def normalizeMediaType(value: String): String =
    value.takeWhile(_ != ';').trim.toLowerCase

  def detect(bytes: Array[Byte]): Option[ImageType] =
    if bytes.length >= 8 &&
      bytes(0) == 0x89.toByte &&
      bytes(1) == 0x50.toByte &&
      bytes(2) == 0x4e.toByte &&
      bytes(3) == 0x47.toByte &&
      bytes(4) == 0x0d.toByte &&
      bytes(5) == 0x0a.toByte &&
      bytes(6) == 0x1a.toByte &&
      bytes(7) == 0x0a.toByte
    then Some(Png)
    else if bytes.length >= 3 &&
      bytes(0) == 0xff.toByte &&
      bytes(1) == 0xd8.toByte &&
      bytes(2) == 0xff.toByte
    then Some(Jpeg)
    else if bytes.length >= 12 &&
      bytes(0) == 'R'.toByte &&
      bytes(1) == 'I'.toByte &&
      bytes(2) == 'F'.toByte &&
      bytes(3) == 'F'.toByte &&
      bytes(8) == 'W'.toByte &&
      bytes(9) == 'E'.toByte &&
      bytes(10) == 'B'.toByte &&
      bytes(11) == 'P'.toByte
    then Some(Webp)
    else None
