package momo.api.usecases

import cats.syntax.functor.*
import cats.Functor
import momo.api.domain.MatchRecord
import momo.api.errors.AppError
import momo.api.repositories.MatchesRepository

final class GetMatch[F[_]: Functor](matches: MatchesRepository[F]):
  def run(id: String): F[Either[AppError, MatchRecord]] = matches.find(id)
    .map(_.toRight(AppError.NotFound("match", id)))
