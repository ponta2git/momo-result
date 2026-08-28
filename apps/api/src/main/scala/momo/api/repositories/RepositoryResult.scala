package momo.api.repositories

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.errors.{AppError, AppException}

/**
 * Translates an expected application rejection after an adapter-local effect has crossed its
 * transaction boundary. Unexpected failures remain on `F`'s throwable channel.
 *
 * Callers must apply this to the lifted facade effect, not to `ConnectionIO`: a database rejection
 * must first leave the transaction through rollback before it is represented as a value.
 */
private[api] object RepositoryResult:
  def capture[F[_]: MonadThrow, A](effect: F[A]): F[Either[AppError, A]] = effect.attempt.flatMap {
    case Right(value) => value.asRight[AppError].pure[F]
    case Left(error: AppException) => error.error.asLeft[A].pure[F]
    case Left(error) => MonadThrow[F].raiseError(error)
  }
end RepositoryResult
