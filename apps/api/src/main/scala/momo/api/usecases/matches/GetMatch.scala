package momo.api.usecases.matches

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.ids.MatchId
import momo.api.domain.{MatchDetail, MatchIdentity}
import momo.api.errors.AppError
import momo.api.repositories.MatchDetailReadModel

final class GetMatch[F[_]: Functor](matches: MatchDetailReadModel[F]):
  def run(id: MatchId): F[Either[AppError, MatchDetail]] = matches.find(id)
    .map(_.toRight(AppError.NotFound("match", id.value)))

  def identity(id: MatchId): F[Either[AppError, MatchIdentity]] = matches.identity(id)
    .map(_.toRight(AppError.NotFound("match", id.value)))
