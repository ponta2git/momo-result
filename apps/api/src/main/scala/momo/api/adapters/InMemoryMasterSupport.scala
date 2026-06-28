package momo.api.adapters

import cats.effect.Sync

import momo.api.errors.{AppError, AppException}

private[adapters] def masterConflict(message: String): AppException =
  new AppException(AppError.Conflict(message))

private[adapters] def notFound(resource: String, id: String): AppException =
  new AppException(AppError.NotFound(resource, id))

private[adapters] def complete[F[_]: Sync, A](result: Either[AppException, A]): F[A] = result match
  case Right(value) => Sync[F].pure(value)
  case Left(error) => Sync[F].raiseError(error)

private[adapters] def completeUnit[F[_]: Sync](result: Either[AppException, Unit]): F[Unit] = complete(result)
