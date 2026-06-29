package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import doobie.Transactor

import momo.api.db.Database
import momo.api.repositories.MatchDraftsRepository

/** Backwards-compatible class facade. */
final class PostgresMatchDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftsRepository[F]:
  private val delegate: MatchDraftsRepository[F] = MatchDraftsRepository
    .fromAlg(PostgresMatchDrafts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchDraftsRepository
