package momo.api.usecases.syntax

import cats.Functor
import cats.data.EitherT
import cats.syntax.functor.*

import momo.api.errors.AppError

/**
 * Small, opinionated combinators for usecase composition.
 *
 * Phase 4-a goal: collapse the most common `EitherT(...map(_.toRight(...)))` and
 * `EitherT.fromEither[F](Either.cond(boolean, (), error))` patterns into named extensions so
 * usecase `for` blocks read top-to-bottom without ceremonial wrappers. Behaviour is identical to
 * the desugared form — only the spelling changes.
 *
 * Naming convention:
 *   - `orError(error)` / `orNotFound(resource, id)` — lift `F[Option[A]]` into `EitherT[F, AppError, A]`.
 *   - `ensureF(error)` / `ensureFoundF(resource, id)` — lift `F[Boolean]` into `EitherT[F, AppError, Unit]`,
 *     failing with the supplied error when the boolean is `false`.
 *
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

  extension [F[_]](fb: F[Boolean])
    /** Fail with the supplied error when the boolean result is `false`. */
    def ensureF(error: => AppError)(using F: Functor[F]): EitherT[F, AppError, Unit] =
      EitherT(fb.map(found => Either.cond(found, (), error)))

    /** Fail with [[AppError.NotFound]] when the boolean result is `false`. */
    def ensureFoundF(resource: String, id: String)(using
        F: Functor[F]
    ): EitherT[F, AppError, Unit] = ensureF(AppError.NotFound(resource, id))

end UseCaseSyntax
