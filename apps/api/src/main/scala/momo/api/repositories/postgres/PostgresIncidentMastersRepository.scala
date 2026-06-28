package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.*
import momo.api.repositories.*
import momo.api.repositories.postgres.PostgresMeta.given

object PostgresIncidentMasters:

  val alg: IncidentMastersAlg[ConnectionIO] = new IncidentMastersAlg[ConnectionIO]:
    override def list: ConnectionIO[List[IncidentMaster]] = sql"""
        SELECT id, key, display_name, display_order, created_at
        FROM incident_masters
        ORDER BY display_order, id
      """.query[IncidentMaster].to[List]
end PostgresIncidentMasters

final class PostgresIncidentMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends IncidentMastersRepository[F]:
  private val delegate: IncidentMastersRepository[F] = IncidentMastersRepository
    .fromAlg(PostgresIncidentMasters.alg, Database.transactK(transactor))

  export delegate.*
end PostgresIncidentMastersRepository
