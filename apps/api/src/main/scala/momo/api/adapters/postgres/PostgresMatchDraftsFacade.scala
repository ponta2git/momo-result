package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import doobie.Transactor

import momo.api.repositories.MatchDraftsRepository

final class PostgresMatchDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftsRepository[F]:
  private val delegate: MatchDraftsRepository[F] = MatchDraftsRepository
    .fromAlg(PostgresMatchDrafts.alg, transactor.trans)

  export delegate.*
end PostgresMatchDraftsRepository
