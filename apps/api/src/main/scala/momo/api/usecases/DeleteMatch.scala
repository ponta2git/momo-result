package momo.api.usecases

import cats.syntax.functor.*
import cats.Functor
import momo.api.errors.AppError
import momo.api.repositories.MatchesRepository

final class DeleteMatch[F[_]: Functor](matches: MatchesRepository[F]):
  def run(id: String): F[Either[AppError, Unit]] = matches.delete(id)
    .map(deleted => if deleted then Right(()) else Left(AppError.NotFound("match", id)))
