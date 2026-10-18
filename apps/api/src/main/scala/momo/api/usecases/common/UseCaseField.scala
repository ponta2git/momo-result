package momo.api.usecases.common

import cats.syntax.all.*

import momo.api.domain.constraints.TextLimits
import momo.api.domain.{MatchNoInEvent, OcrLayoutFamily}
import momo.api.errors.AppError

/**
 * Field-level validation rules shared by use case boundary inputs.
 *
 * Stable IDs and code-owned layout values have distinct validation rules.
 */
private[usecases] object UseCaseField:
  private val SlugPattern = "^[a-z][a-z0-9_]{1,63}$".r

  def slug(field: String, value: String): Either[AppError, String] = SlugPattern.pattern
    .matcher(value).matches() match
    case true => Right(value)
    case false => Left(AppError.ValidationFailed(
        s"$field must match ^[a-z][a-z0-9_]{1,63}$$ (lowercase, starts with a letter)."
      ))

  def layoutFamily(value: String): Either[AppError, String] = OcrLayoutFamily.fromLegacy(value)
    .map(_.wire).toRight(AppError.ValidationFailed(
      "layoutFamily must be momotetsu_2, world, or reiwa (known legacy aliases are accepted)."
    ))

  def optionalLayoutFamily(value: Option[String]): Either[AppError, Option[String]] =
    value.traverse(layoutFamily)

  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    if trimmed.isEmpty then Left(AppError.ValidationFailed(s"$field must not be blank."))
    else Right(trimmed)

  def name(field: String, value: String): Either[AppError, String] = nonBlank(field, value).flatMap {
    trimmed =>
      Either.cond(
        trimmed.codePointCount(0, trimmed.length) <= TextLimits.NameMaxCodePoints,
        trimmed,
        AppError.ValidationFailed(
          s"$field must contain at most ${TextLimits.NameMaxCodePoints} characters."
        ),
      )
  }

  def optionalMatchNoInEvent(value: Option[Int]): Either[AppError, Option[MatchNoInEvent]] =
    value.traverse(number =>
      MatchNoInEvent.fromInt(number).leftMap(error => AppError.ValidationFailed(error.message))
    )
