package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.*
import momo.api.domain.ids.IncidentMasterId
import momo.api.repositories.*
import momo.api.adapters.postgres.PostgresMeta.given

object PostgresIncidentMasters:
  private final case class IncidentMasterRow(
      id: IncidentMasterId,
      key: String,
      displayName: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private def fromRow(row: IncidentMasterRow): IncidentMaster = IncidentMaster(
    id = row.id,
    key = row.key,
    displayName = row.displayName,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  val alg: IncidentMastersAlg[ConnectionIO] = new IncidentMastersAlg[ConnectionIO]:
    override def list: ConnectionIO[List[IncidentMaster]] = sql"""
        SELECT id, key, display_name, display_order, created_at
        FROM incident_masters
        ORDER BY display_order, id
      """.query[IncidentMasterRow].to[List].map(_.map(fromRow))
end PostgresIncidentMasters

final class PostgresIncidentMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends IncidentMastersRepository[F]:
  private val delegate: IncidentMastersRepository[F] = IncidentMastersRepository
    .fromAlg(PostgresIncidentMasters.alg, Database.transactK(transactor))

  export delegate.*
end PostgresIncidentMastersRepository
