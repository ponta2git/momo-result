package momo.api.usecases

import cats.Functor

import momo.api.domain.MatchRecord
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.MatchesRepository
import momo.api.usecases.syntax.UseCaseSyntax.*

final class GetMatch[F[_]: Functor](matches: MatchesRepository[F]):
  def run(id: MatchId): F[Either[AppError, MatchRecord]] = matches.find(id)
    .orNotFound("match", id.value).value
