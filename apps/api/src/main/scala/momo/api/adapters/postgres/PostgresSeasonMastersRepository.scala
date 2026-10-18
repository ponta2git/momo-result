package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
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

  private def fromRow(row: SeasonMasterRow): SeasonMaster = SeasonMaster(
    id = row.id,
    gameTitleId = row.gameTitleId,
    name = row.name,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  def alg(using ids: PostgresIdentities): SeasonMastersAlg[ConnectionIO] =
    new SeasonMastersAlg[ConnectionIO]:
      override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[SeasonMaster]] =
        val where = gameTitleId.fold(Fragment.empty)(id =>
          fr"WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}"
        )
        val order =
          fr"ORDER BY ${ids.wireReference(Entity.GameTitles, fr"season_masters.game_title_id")}, display_order, created_at, ${ids.wireId("season_masters")}"
        val nameLimit = PostgresReadBudget.NameCodePoints
        val bounded = fr"""SELECT char_length(name) <= $nameLimit,
        ${ids.wireId("season_masters")}, ${ids.wireReference(
            Entity.GameTitles,
            fr"season_masters.game_title_id"
          )}, LEFT(name, $nameLimit), display_order, created_at FROM season_masters"""
        PostgresReadBudget.guardedRows[SeasonMasterRow](
          bounded ++ where ++ order,
          PostgresReadBudget.CatalogRows,
          "Season catalog"
        ).map(_.map(fromRow))

      override def find(id: SeasonMasterId): ConnectionIO[Option[SeasonMaster]] =
        val nameLimit = PostgresReadBudget.NameCodePoints
        PostgresReadBudget.guardedRows[SeasonMasterRow](
          fr"""SELECT char_length(name) <= $nameLimit,
          ${ids.wireId("season_masters")}, ${ids.wireReference(
              Entity.GameTitles,
              fr"season_masters.game_title_id"
            )}, LEFT(name, $nameLimit), display_order, created_at FROM season_masters WHERE id = ${ids.lookup(
              Entity.SeasonMasters,
              id.value
            )}""",
          1,
          "Season detail",
        ).map(_.headOption.map(fromRow))

      override def createWithNextDisplayOrder(season: SeasonMaster): ConnectionIO[SeasonMaster] =
        (for
          newId <- ids.newId(season.id.value)
          titleId <- ids.requireReference(Entity.GameTitles, season.gameTitleId.value)
          titleLegacy <-
            sql"SELECT ${ids.wireReference(Entity.GameTitles, titleId)}".query[String].unique
          lockKey = s"momo:season_masters:$titleLegacy:display_order"
          // The allocation needs a new READ COMMITTED snapshot after any lock wait.
          _ <- sql"SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)".query[Unit].unique
          row <- sql"""
          INSERT INTO season_masters (${ids.idColumns}, game_title_id, name, display_order, created_at)
          SELECT $newId, $titleId, ${season.name}, COALESCE(MAX(display_order), 0) + 1, ${season.createdAt}
          FROM season_masters WHERE game_title_id = $titleId
          RETURNING ${ids.wireId("season_masters")}, ${ids.wireReference(
              Entity.GameTitles,
              fr"season_masters.game_title_id"
            )}, name, display_order, created_at
        """.query[SeasonMasterRow].unique
        yield fromRow(row)).exceptSomeSqlState {
          case state if isUniqueViolation(state) =>
            conflict(s"season_master already exists: ${season.id.value} or ${season.name}")
          case state if isForeignKeyViolation(state) =>
            appError(AppError.NotFound("game_title", season.gameTitleId.value))
        }

      override def update(season: SeasonMaster): ConnectionIO[Unit] = sql"""
        UPDATE season_masters
        SET name = ${season.name}
        WHERE id = ${ids.lookup(Entity.SeasonMasters, season.id.value)}
      """.update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("season master", season.id.value)
      }.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"season_master already exists: ${season.id.value} or ${season.name}")
      }

      override def delete(id: SeasonMasterId): ConnectionIO[Unit] = (for
        deletedDrafts <- deleteDiscardedDrafts(
          fr"season_master_id = ${ids.lookup(Entity.SeasonMasters, id.value)}"
        )
        deleted <-
          sql"DELETE FROM season_masters WHERE id = ${ids.lookup(Entity.SeasonMasters, id.value)}".update.run
        _ <- deleted match
          case 1 => ().pure[ConnectionIO]
          case _ => notFound("season master", id.value)
        _ <- PostgresResultNotificationCancellation.afterDeletion(deletedDrafts, Nil)
      yield ()).exceptSomeSqlState {
        case state if isForeignKeyViolation(state) => conflict("season master is still referenced.")
      }

end PostgresSeasonMasters

final class PostgresSeasonMastersRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends SeasonMastersRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: SeasonMastersRepository[F] = SeasonMastersRepository
    .fromAlg(PostgresSeasonMasters.alg, transactor.trans)

  export delegate.*
end PostgresSeasonMastersRepository
