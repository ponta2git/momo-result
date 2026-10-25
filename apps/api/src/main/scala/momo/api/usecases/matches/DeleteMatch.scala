package momo.api.usecases.matches

import cats.Functor
import cats.syntax.functor.*

import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.MatchesRepository

final class DeleteMatch[F[_]: Functor](matches: MatchesRepository[F]):
  def run(id: MatchId): F[Either[AppError, Unit]] = run(id, None)

  def run(id: MatchId, actor: Option[AccountId]): F[Either[AppError, Unit]] =
    matches.delete(id, actor)
      .map(deleted => if deleted then Right(()) else Left(AppError.NotFound("match", id.value)))
