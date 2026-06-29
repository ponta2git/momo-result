package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.constraints.RefinedTypes.BoundaryText
import momo.api.errors.AppError
import momo.api.validation.RefinedValidation

object BoundaryId:
  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    RefinedValidation.validate[String, BoundaryText](field, trimmed).leftMap { _ =>
      if trimmed.isEmpty then AppError.ValidationFailed(s"$field must not be blank.")
      else AppError.ValidationFailed(s"$field must not contain control characters.")
    }.map(value => value)

  def required[A](field: String, value: String)(
      parse: String => Either[String, A]
  ): Either[AppError, A] = nonBlank(field, value).flatMap(trimmed =>
    parse(trimmed).leftMap(_ => AppError.ValidationFailed(s"$field is invalid."))
  )

  def optional[A](field: String, value: Option[String])(
      parse: String => Either[String, A]
  ): Either[AppError, Option[A]] = value.traverse(required(field, _)(parse))
