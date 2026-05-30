package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.errors.AppError

object BoundaryId:
  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    if trimmed.isEmpty then Left(AppError.ValidationFailed(s"$field must not be blank."))
    else if containsControlCharacter(trimmed) then
      Left(AppError.ValidationFailed(s"$field must not contain control characters."))
    else Right(trimmed)

  def required[A](field: String, value: String)(
      parse: String => Either[String, A]
  ): Either[AppError, A] = nonBlank(field, value).flatMap(trimmed =>
    parse(trimmed).leftMap(_ => AppError.ValidationFailed(s"$field is invalid."))
  )

  def optional[A](field: String, value: Option[String])(
      parse: String => Either[String, A]
  ): Either[AppError, Option[A]] = value.traverse(required(field, _)(parse))

  private def containsControlCharacter(value: String): Boolean = value.exists(_.isControl)
