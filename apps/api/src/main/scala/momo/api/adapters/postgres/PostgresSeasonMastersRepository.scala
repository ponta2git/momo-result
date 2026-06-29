package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.*

object PostgresSeasonMasters:
  private final case class SeasonMasterRow(
      id: SeasonMasterId,
      gameTitleId: GameTitleId,
      name: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private val selectAll =
    fr"SELECT id, game_title_id, name, display_order, created_at FROM season_masters"

  private def fromRow(row: SeasonMasterRow): SeasonMaster = SeasonMaster(
    id = row.id,
    gameTitleId = row.gameTitleId,
    name = row.name,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  val alg: SeasonMastersAlg[ConnectionIO] = new SeasonMastersAlg[ConnectionIO]:
    override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[SeasonMaster]] =
      val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
      val order = fr"ORDER BY game_title_id, display_order, created_at, id"
      (selectAll ++ where ++ order).query[SeasonMasterRow].to[List].map(_.map(fromRow))

    override def find(id: SeasonMasterId): ConnectionIO[Option[SeasonMaster]] =
      (selectAll ++ fr"WHERE id = $id").query[SeasonMasterRow].option.map(_.map(fromRow))

    override def create(season: SeasonMaster): ConnectionIO[Unit] = sql"""
        INSERT INTO season_masters (id, game_title_id, name, display_order, created_at)
        VALUES (${season.id}, ${season.gameTitleId}, ${season.name}, ${season
        .displayOrder}, ${season.createdAt})
      """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"season_master already exists: ${season.id.value} or ${season.name}")
      case state if isForeignKeyViolation(state) =>
        appError(AppError.NotFound("game_title", season.gameTitleId.value))
    }

    override def createWithNextDisplayOrder(season: SeasonMaster): ConnectionIO[SeasonMaster] =
      val lockKey = s"momo:season_masters:${season.gameTitleId.value}:display_order"
      sql"""
        WITH display_order_lock AS (
          SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)
        ),
        next_order AS (
          SELECT COALESCE(MAX(display_order), 0) + 1 AS display_order
          FROM season_masters
          WHERE game_title_id = ${season.gameTitleId}
        )
        INSERT INTO season_masters (id, game_title_id, name, display_order, created_at)
        SELECT ${season.id}, ${season.gameTitleId}, ${season
          .name}, next_order.display_order, ${season.createdAt}
        FROM display_order_lock, next_order
        RETURNING id, game_title_id, name, display_order, created_at
      """.query[SeasonMasterRow].unique.map(fromRow).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"season_master already exists: ${season.id.value} or ${season.name}")
        case state if isForeignKeyViolation(state) =>
          appError(AppError.NotFound("game_title", season.gameTitleId.value))
      }

    override def update(season: SeasonMaster): ConnectionIO[Unit] = sql"""
        UPDATE season_masters
        SET name = ${season.name}
        WHERE id = ${season.id}
      """.update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("season master", season.id.value)
    }.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"season_master already exists: ${season.id.value} or ${season.name}")
    }

    override def delete(id: SeasonMasterId): ConnectionIO[Unit] = deleteDiscardedDrafts(
      fr"season_master_id = $id"
    ) *> sql"DELETE FROM season_masters WHERE id = $id".update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("season master", id.value)
    }.exceptSomeSqlState {
      case state if isForeignKeyViolation(state) => conflict("season master is still referenced.")
    }

end PostgresSeasonMasters

final class PostgresSeasonMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SeasonMastersRepository[F]:
  private val delegate: SeasonMastersRepository[F] = SeasonMastersRepository
    .fromAlg(PostgresSeasonMasters.alg, Database.transactK(transactor))

  export delegate.*
end PostgresSeasonMastersRepository
