package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.*

object PostgresMapMasters:
  private final case class MapMasterRow(
      id: MapMasterId,
      gameTitleId: GameTitleId,
      name: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private val selectAll =
    fr"SELECT id, game_title_id, name, display_order, created_at FROM map_masters"

  private def fromRow(row: MapMasterRow): MapMaster = MapMaster(
    id = row.id,
    gameTitleId = row.gameTitleId,
    name = row.name,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  val alg: MapMastersAlg[ConnectionIO] = new MapMastersAlg[ConnectionIO]:
    override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[MapMaster]] =
      val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
      val order = fr"ORDER BY game_title_id, display_order, created_at, id"
      (selectAll ++ where ++ order).query[MapMasterRow].to[List].map(_.map(fromRow))

    override def find(id: MapMasterId): ConnectionIO[Option[MapMaster]] =
      (selectAll ++ fr"WHERE id = $id").query[MapMasterRow].option.map(_.map(fromRow))

    override def createWithNextDisplayOrder(map: MapMaster): ConnectionIO[MapMaster] =
      val lockKey = s"momo:map_masters:${map.gameTitleId.value}:display_order"
      sql"""
        WITH display_order_lock AS (
          SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)
        ),
        next_order AS (
          SELECT COALESCE(MAX(display_order), 0) + 1 AS display_order
          FROM map_masters
          WHERE game_title_id = ${map.gameTitleId}
        )
        INSERT INTO map_masters (id, game_title_id, name, display_order, created_at)
        SELECT ${map.id}, ${map.gameTitleId}, ${map.name}, next_order.display_order, ${map
          .createdAt}
        FROM display_order_lock, next_order
        RETURNING id, game_title_id, name, display_order, created_at
      """.query[MapMasterRow].unique.map(fromRow).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"map_master already exists: ${map.id.value} or ${map.name}")
        case state if isForeignKeyViolation(state) =>
          appError(AppError.NotFound("game_title", map.gameTitleId.value))
      }

    override def update(map: MapMaster): ConnectionIO[Unit] = sql"""
        UPDATE map_masters
        SET name = ${map.name}
        WHERE id = ${map.id}
      """.update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("map master", map.id.value)
    }.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"map_master already exists: ${map.id.value} or ${map.name}")
    }

    override def delete(id: MapMasterId): ConnectionIO[Unit] = deleteDiscardedDrafts(
      fr"map_master_id = $id"
    ) *> sql"DELETE FROM map_masters WHERE id = $id".update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("map master", id.value)
    }.exceptSomeSqlState {
      case state if isForeignKeyViolation(state) => conflict("map master is still referenced.")
    }

end PostgresMapMasters

final class PostgresMapMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MapMastersRepository[F]:
  private val delegate: MapMastersRepository[F] = MapMastersRepository
    .fromAlg(PostgresMapMasters.alg, transactor.trans)

  export delegate.*
end PostgresMapMastersRepository
