package momo.api.validation

import cats.syntax.all.*
import io.github.iltotore.iron.*

import momo.api.domain.constraints.RefinedTypes
import momo.api.errors.AppError

object RefinedValidation:
  inline def validate[A, C](field: String, value: A)(using
      Constraint[A, C]): Either[AppError, A :| C] =
    RefinedTypes.refine[A, C](field, value).leftMap(AppError.ValidationFailed.apply)
