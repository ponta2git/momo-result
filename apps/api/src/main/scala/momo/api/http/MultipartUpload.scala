package momo.api.http

import momo.api.errors.AppError
import sttp.model.Part

private[http] final case class MultipartUpload(
    fileName: Option[String],
    contentType: Option[String],
    bytes: Array[Byte],
)

private[http] object MultipartUpload:
  def file(parts: Seq[Part[Array[Byte]]]): Either[AppError, MultipartUpload] = parts
    .find(_.name == "file")
    .map(part => MultipartUpload(part.fileName, part.contentType.map(_.toString), part.body))
    .toRight(AppError.ValidationFailed("Multipart field 'file' is required."))
