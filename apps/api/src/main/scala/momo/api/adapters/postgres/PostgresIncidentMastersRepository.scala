package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.IncidentMasterId
import momo.api.repositories.*

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
    override def list: ConnectionIO[List[IncidentMaster]] =
      val nameLimit = PostgresReadBudget.NameCodePoints
      val keyLimit = PostgresReadBudget.KeyCodePoints
      PostgresReadBudget.guardedRows[IncidentMasterRow](
        sql"""
        SELECT char_length(key) <= $keyLimit AND char_length(display_name) <= $nameLimit,
               id, LEFT(key, $keyLimit), LEFT(display_name, $nameLimit), display_order, created_at
        FROM incident_masters
        ORDER BY display_order, id
      """,
        PostgresReadBudget.CatalogRows,
        "Incident catalog"
      ).map(_.map(fromRow))
end PostgresIncidentMasters

final class PostgresIncidentMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends IncidentMastersRepository[F]:
  private val delegate: IncidentMastersRepository[F] = IncidentMastersRepository
    .fromAlg(PostgresIncidentMasters.alg, transactor.trans)

  export delegate.*
end PostgresIncidentMastersRepository
