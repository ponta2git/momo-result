package momo.api.usecases.common

import cats.syntax.all.*

import momo.api.domain.MatchNoInEvent
import momo.api.domain.constraints.TextLimits
import momo.api.errors.AppError

/**
 * Field-level validation rules shared by use case boundary inputs.
 *
 * Master creation accepts UUIDs and existing client aliases. Profile keys retain their semantic
 * lowercase contract.
 */
private[usecases] object UseCaseField:
  private val SlugPattern = "^[a-z][a-z0-9_]{1,63}$".r
  private val UuidPattern =
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$".r
  private val StableKeyPattern = "^[a-z][a-z0-9_]{0,63}$".r

  def masterId(field: String, value: String): Either[AppError, String] =
    if UuidPattern.pattern.matcher(value).matches() ||
      SlugPattern.pattern.matcher(value).matches()
    then Right(value)
    else
      Left(AppError.ValidationFailed(
        s"$field must match a UUID or a legacy lowercase identifier."
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
