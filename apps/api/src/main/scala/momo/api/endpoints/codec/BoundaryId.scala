package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.errors.AppError

object BoundaryId:
  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    Either.cond(trimmed.nonEmpty, trimmed, AppError.ValidationFailed(s"$field must not be blank."))

  def required[A](field: String, value: String)(
      parse: String => Either[String, A]
  ): Either[AppError, A] = parse(value)
    .leftMap(_ => AppError.ValidationFailed(s"$field must not be blank."))

  def optional[A](field: String, value: Option[String])(
      parse: String => Either[String, A]
  ): Either[AppError, Option[A]] = value.traverse(required(field, _)(parse))
