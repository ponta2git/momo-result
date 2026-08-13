package momo.api.usecases.syntax

import cats.data.EitherT
import cats.syntax.applicativeError.*
import cats.syntax.functor.*
import cats.{Functor, MonadThrow}

import momo.api.errors.{AppError, AppException}

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

  extension [F[_], A](fa: F[A])
    /** Convert expected repository-domain failures into the usecase error channel. */
    def recoverAppError(using F: MonadThrow[F]): EitherT[F, AppError, A] = EitherT {
      F.flatMap(fa.attempt) {
        case Right(value) => F.pure(Right(value))
        case Left(app: AppException) => F.pure(Left(app.error))
        case Left(error) => F.raiseError[Either[AppError, A]](error)
      }
    }

end UseCaseSyntax
