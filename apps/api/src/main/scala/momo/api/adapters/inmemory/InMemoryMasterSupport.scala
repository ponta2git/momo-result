package momo.api.adapters.inmemory

import cats.effect.Sync
import cats.syntax.all.*

import momo.api.errors.{AppError, AppException}

private[adapters] def masterConflict(message: String): AppException =
  new AppException(AppError.Conflict(message))

private[adapters] def notFound(resource: String, id: String): AppException =
  new AppException(AppError.NotFound(resource, id))

private[adapters] def complete[F[_]: Sync, A](result: Either[AppException, A]): F[A] =
  result.liftTo[F]

private[adapters] def completeUnit[F[_]: Sync](result: Either[AppException, Unit]): F[Unit] =
  complete(result)
