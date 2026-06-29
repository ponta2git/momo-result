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
import momo.api.repositories.*

object PostgresGameTitles:
  private final case class GameTitleRow(
      id: GameTitleId,
      name: String,
      layoutFamily: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private val selectAll =
    fr"SELECT id, name, layout_family, display_order, created_at FROM game_titles"

  private def fromRow(row: GameTitleRow): GameTitle = GameTitle(
    id = row.id,
    name = row.name,
    layoutFamily = row.layoutFamily,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  val alg: GameTitlesAlg[ConnectionIO] = new GameTitlesAlg[ConnectionIO]:
    override def list: ConnectionIO[List[GameTitle]] =
      (selectAll ++ fr"ORDER BY display_order, created_at, id").query[GameTitleRow].to[List]
        .map(_.map(fromRow))

    override def find(id: GameTitleId): ConnectionIO[Option[GameTitle]] =
      (selectAll ++ fr"WHERE id = $id").query[GameTitleRow].option.map(_.map(fromRow))

    override def create(title: GameTitle): ConnectionIO[Unit] = sql"""
        INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
        VALUES (${title.id}, ${title.name}, ${title.layoutFamily}, ${title.displayOrder}, ${title
        .createdAt})
      """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
    }

    override def createWithNextDisplayOrder(title: GameTitle): ConnectionIO[GameTitle] =
      val lockKey = "momo:game_titles:display_order"
      sql"""
        WITH display_order_lock AS (
          SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)
        ),
        next_order AS (
          SELECT COALESCE(MAX(display_order), 0) + 1 AS display_order
          FROM game_titles
        )
        INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
        SELECT ${title.id}, ${title.name}, ${title.layoutFamily}, next_order.display_order, ${title
          .createdAt}
        FROM display_order_lock, next_order
        RETURNING id, name, layout_family, display_order, created_at
      """.query[GameTitleRow].unique.map(fromRow).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
      }

    override def update(title: GameTitle): ConnectionIO[Unit] = sql"""
        UPDATE game_titles
        SET name = ${title.name}, layout_family = ${title.layoutFamily}
        WHERE id = ${title.id}
      """.update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("game title", title.id.value)
    }.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"game_title already exists: ${title.id.value} or ${title.name}")
    }

    override def delete(id: GameTitleId): ConnectionIO[Unit] = deleteDiscardedDrafts(
      fr"game_title_id = $id"
    ) *> sql"DELETE FROM game_titles WHERE id = $id".update.run.flatMap {
      case 1 => ().pure[ConnectionIO]
      case _ => notFound("game title", id.value)
    }.exceptSomeSqlState {
      case state if isForeignKeyViolation(state) => conflict("game title is still referenced.")
    }

end PostgresGameTitles

final class PostgresGameTitlesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends GameTitlesRepository[F]:
  private val delegate: GameTitlesRepository[F] = GameTitlesRepository
    .fromAlg(PostgresGameTitles.alg, Database.transactK(transactor))

  export delegate.*
end PostgresGameTitlesRepository
