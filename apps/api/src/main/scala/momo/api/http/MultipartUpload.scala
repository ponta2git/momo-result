package momo.api.http

import sttp.model.Part

import momo.api.errors.AppError

private[http] final case class MultipartUpload(
    fileName: Option[String],
    contentType: Option[String],
    bytes: Array[Byte],
)

private[http] object MultipartUpload:
  def file(parts: Seq[Part[Array[Byte]]]): Either[AppError, MultipartUpload] = parts
    .filter(_.name == "file").toList match
    case Nil => Left(AppError.ValidationFailed("Multipart field 'file' is required."))
    case part :: Nil =>
      Right(MultipartUpload(part.fileName, part.contentType.map(_.toString), part.body))
    case _ => Left(AppError.ValidationFailed("Multipart field 'file' must be provided once."))
