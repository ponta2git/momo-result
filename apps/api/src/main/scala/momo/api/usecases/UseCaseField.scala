package momo.api.usecases

import cats.syntax.all.*

import momo.api.errors.AppError

/**
 * Field-level validation rules shared by use case boundary inputs.
 *
 * Stable IDs and profile keys become DB values and API contract values; keep them lowercase,
 * URL-safe, and trivially comparable across summit and momo-result.
 */
private[usecases] object UseCaseField:
  private val SlugPattern = "^[a-z][a-z0-9_]{1,63}$".r
  private val StableKeyPattern = "^[a-z][a-z0-9_]{0,63}$".r

  def slug(field: String, value: String): Either[AppError, String] = SlugPattern.pattern
    .matcher(value).matches() match
    case true => Right(value)
    case false => Left(AppError.ValidationFailed(
        s"$field must match ^[a-z][a-z0-9_]{1,63}$$ (lowercase, starts with a letter)."
      ))

  def stableKey(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    StableKeyPattern.pattern.matcher(trimmed).matches() match
      case true => Right(trimmed)
      case false => Left(AppError.ValidationFailed(
          s"$field must match ^[a-z][a-z0-9_]{0,63}$$ (lowercase, starts with a letter)."
        ))

  def optionalStableKey(field: String, value: Option[String]): Either[AppError, Option[String]] =
    value.traverse(stableKey(field, _))

  def nonBlank(field: String, value: String): Either[AppError, String] =
    val trimmed = value.trim
    if trimmed.isEmpty then Left(AppError.ValidationFailed(s"$field must not be blank."))
    else Right(trimmed)
