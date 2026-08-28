package momo.api.usecases.syntax

import cats.Functor
import cats.data.EitherT
import cats.syntax.functor.*

import momo.api.errors.AppError

/**
 * Small, opinionated combinators for usecase composition.
 *
 * These extensions name the common conversions from repository results into the usecase error
 * channel. Behaviour is identical to the equivalent `EitherT` expressions.
 *
 * Naming convention:
 *   - `orError(error)` / `orNotFound(resource, id)` — lift `F[Option[A]]` into `EitherT[F, AppError, A]`.
 * No new helpers are introduced for pure `Either.cond` — those already read fine in stdlib form.
 */
object UseCaseSyntax:

  extension [F[_], A](fa: F[Option[A]])
    /** Convert a missing value into an arbitrary [[AppError]]. */
    def orError(error: => AppError)(using F: Functor[F]): EitherT[F, AppError, A] =
      EitherT(fa.map(_.toRight(error)))

    /** Convert a missing value into [[AppError.NotFound]]. */
    def orNotFound(resource: String, id: String)(using F: Functor[F]): EitherT[F, AppError, A] =
      orError(AppError.NotFound(resource, id))

end UseCaseSyntax
