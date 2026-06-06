package momo.api.http

import momo.api.errors.AppError

private[http] object HttpDownloadHeaders:
  val PrivateNoStore: String = "private, no-store"
  val Nosniff: String = "nosniff"

  def attachment(fileName: String): Either[AppError, String] = Either.cond(
    isSafeFileName(fileName),
    s"""attachment; filename="$fileName"""",
    AppError.Internal("Download filename failed safety validation."),
  )

  private[http] def isSafeFileName(value: String): Boolean = value.nonEmpty &&
    value.length <= 128 && !value.startsWith(".") && !value.contains("..") &&
    value.forall(isSafeFileNameChar)

  private def isSafeFileNameChar(value: Char): Boolean =
    (value >= 'A' && value <= 'Z') ||
      (value >= 'a' && value <= 'z') ||
      (value >= '0' && value <= '9') || value == '-' || value == '_' || value == '.'
