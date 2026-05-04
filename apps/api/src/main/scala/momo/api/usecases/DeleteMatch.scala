package momo.api.usecases

import cats.Functor
import cats.syntax.functor.*

import momo.api.errors.AppError
import momo.api.repositories.MatchesRepository

final class DeleteMatch[F[_]: Functor](matches: MatchesRepository[F]):
  def run(id: String): F[Either[AppError, Unit]] = matches.delete(id)
    .map(deleted => if deleted then Right(()) else Left(AppError.NotFound("match", id)))
