package momo.api.domain.constraints

import cats.syntax.all.*
import io.github.iltotore.iron.*
import io.github.iltotore.iron.constraint.all.*

import momo.api.errors.AppError

object BoundaryConstraints:
  type NonBlank = Not[Blank] DescribedAs "must not be blank"
  type NoControlChars = Match["^[^\\p{Cntrl}]*$"] DescribedAs
    "must not contain control characters"
  type BoundaryText = NonBlank & NoControlChars
  type Slug = (Match["^[a-z0-9][a-z0-9_-]*$"] & MaxLength[80]) DescribedAs
    "must be a stable lowercase slug"
  type StableKey = (Match["^[A-Za-z0-9][A-Za-z0-9._-]*$"] & MaxLength[120]) DescribedAs
    "must be a stable key"
  type MetricKey =
    (Match["^[A-Za-z][A-Za-z0-9]*(?:[.][A-Za-z][A-Za-z0-9]*)*$"] &
      MaxLength[120]) DescribedAs "must be a dot-separated metric key"
  type ViewKey = (Match["^[a-z][a-z0-9-]*$"] & MaxLength[80]) DescribedAs
    "must be a stable view key"
  type PortRange = GreaterEqual[1] & LessEqual[65535]
  type NonNegative = GreaterEqual[0]

  type NonBlankString = String :| NonBlank
  type BoundaryTextString = String :| BoundaryText
  type SlugString = String :| Slug
  type StableKeyString = String :| StableKey
  type MetricIdString = String :| MetricKey
  type ViewKeyString = String :| ViewKey
  type PortNumber = Int :| PortRange
  type PositiveInt = Int :| Positive
  type NonNegativeInt = Int :| NonNegative
  type PositiveLong = Long :| Positive
  type NonNegativeLong = Long :| NonNegative

  inline def validate[A, C](field: String, value: A)(using
      Constraint[A, C]): Either[AppError, A :| C] =
    value.refineEither[C].leftMap(message => AppError.ValidationFailed(s"$field $message"))
