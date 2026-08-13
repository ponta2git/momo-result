package momo.api.domain.constraints

import cats.syntax.all.*
import io.github.iltotore.iron.*
import io.github.iltotore.iron.constraint.all.*

object RefinedTypes:
  type NonBlank = Not[Blank] DescribedAs "must not be blank"
  type NoControlChars = Match["^[^\\p{Cntrl}]*$"] DescribedAs
    "must not contain control characters"
  type BoundaryText = NonBlank & NoControlChars
  type PortRange = GreaterEqual[1] & LessEqual[65535]
  type NonNegative = GreaterEqual[0]

  type PortNumber = Int :| PortRange
  type PositiveInt = Int :| Positive
  type NonNegativeInt = Int :| NonNegative
  type PositiveLong = Long :| Positive

  inline def refine[A, C](field: String, value: A)(using Constraint[A, C]): Either[String, A :| C] =
    value.refineEither[C].leftMap(message => s"$field $message")
