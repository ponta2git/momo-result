package momo.api.adapters.storage

import momo.api.errors.AppError

private[storage] object ImageValidation:
  val MaxBytes = 3 * 1024 * 1024
  val MaxWidth = 1920
  val MaxHeight = 1080
  val MaxDimensionsLabel = s"${MaxWidth.toString}x${MaxHeight.toString}"

  final case class ImageType(mediaType: String, extension: String)
  final case class ImageDimensions(width: Long, height: Long):
    def exceedsLimit: Boolean = width <= 0L || height <= 0L || width > MaxWidth.toLong ||
      height > MaxHeight.toLong

  final case class ValidatedImage(imageType: ImageType, dimensions: ImageDimensions)

  val Png: ImageType = ImageType("image/png", "png")
  val Jpeg: ImageType = ImageType("image/jpeg", "jpg")
  val Webp: ImageType = ImageType("image/webp", "webp")
  val SupportedImageTypes: List[ImageType] = List(Png, Jpeg, Webp)

  def validate(
      bytes: Array[Byte],
      contentType: Option[String],
  ): Either[AppError, ValidatedImage] =
    if bytes.length > MaxBytes then
      Left(AppError.PayloadTooLarge(s"Image must be ${MaxBytes.toString} bytes or smaller."))
    else
      detect(bytes) match
        case None =>
          Left(AppError.UnsupportedMediaType("Only PNG, JPEG, and WebP images are supported."))
        case Some(imageType) =>
          dimensions(bytes, imageType) match
            case None => Left(AppError.UnsupportedMediaType("Image dimensions could not be read."))
            case Some(imageDimensions) if imageDimensions.exceedsLimit =>
              Left(
                AppError
                  .PayloadTooLarge(s"Image dimensions must be $MaxDimensionsLabel or smaller.")
              )
            case Some(_)
                if contentType.exists(ct => normalizeMediaType(ct) != imageType.mediaType) =>
              Left(AppError.UnsupportedMediaType("Content-Type does not match the image bytes."))
            case Some(imageDimensions) => Right(ValidatedImage(imageType, imageDimensions))

  def normalizeMediaType(value: String): String = value.takeWhile(_ != ';').trim.toLowerCase

  def detect(bytes: Array[Byte]): Option[ImageType] = ImageFormatParsers.detect(bytes)

  def dimensions(
      bytes: Array[Byte],
      imageType: ImageType,
  ): Option[ImageDimensions] = ImageFormatParsers.dimensions(bytes, imageType)
