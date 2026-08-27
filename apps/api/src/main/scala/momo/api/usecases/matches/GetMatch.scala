package momo.api.usecases.matches

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.MatchRecord
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{LoginAccountsRepository, MatchesRepository}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class MatchDetail(record: MatchRecord, noteUpdatedByDisplayName: Option[String])

final class GetMatch[F[_]: Monad](
    matches: MatchesRepository[F],
    loginAccounts: LoginAccountsRepository[F],
):
  def run(id: MatchId): F[Either[AppError, MatchDetail]] = matches.find(id)
    .orNotFound("match", id.value).semiflatMap { record =>
      record.note.updatedByAccountId.traverse(loginAccounts.find).map(accounts =>
        MatchDetail(record, accounts.flatten.map(_.displayName))
      )
    }.value
