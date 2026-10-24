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

object PostgresMapMasters:
  private final case class MapMasterRow(
      id: MapMasterId,
      gameTitleId: GameTitleId,
      name: String,
      displayOrder: Int,
      createdAt: Instant,
  )

  private def fromRow(row: MapMasterRow): MapMaster = MapMaster(
    id = row.id,
    gameTitleId = row.gameTitleId,
    name = row.name,
    displayOrder = row.displayOrder,
    createdAt = row.createdAt,
  )

  def alg(using ids: PostgresIdentities): MapMastersAlg[ConnectionIO] =
    new MapMastersAlg[ConnectionIO]:
      override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[MapMaster]] =
        val where = gameTitleId.fold(Fragment.empty)(id =>
          fr"WHERE game_title_id = ${ids.lookup(Entity.GameTitles, id.value)}"
        )
        val order =
          fr"ORDER BY ${ids.wireReference(Entity.GameTitles, fr"map_masters.game_title_id")}, display_order, created_at, ${ids.wireId("map_masters")}"
        val nameLimit = PostgresReadBudget.NameCodePoints
        val bounded = fr"""SELECT char_length(name) <= $nameLimit,
        ${ids.wireId("map_masters")}, ${ids.wireReference(
            Entity.GameTitles,
            fr"map_masters.game_title_id"
          )}, LEFT(name, $nameLimit), display_order, created_at FROM map_masters"""
        PostgresReadBudget.guardedRows[MapMasterRow](
          bounded ++ where ++ order,
          PostgresReadBudget.CatalogRows,
          "Map catalog"
        ).map(_.map(fromRow))

      override def find(id: MapMasterId): ConnectionIO[Option[MapMaster]] =
        val nameLimit = PostgresReadBudget.NameCodePoints
        PostgresReadBudget.guardedRows[MapMasterRow](
          fr"""SELECT char_length(name) <= $nameLimit,
          ${ids.wireId("map_masters")}, ${ids.wireReference(
              Entity.GameTitles,
              fr"map_masters.game_title_id"
            )}, LEFT(name, $nameLimit), display_order, created_at FROM map_masters WHERE id = ${ids.lookup(
              Entity.MapMasters,
              id.value
            )}""",
          1,
          "Map detail",
        ).map(_.headOption.map(fromRow))

      override def createWithNextDisplayOrder(map: MapMaster): ConnectionIO[MapMaster] =
        (for
          newId <- ids.newId(map.id.value)
          titleId <- ids.requireReference(Entity.GameTitles, map.gameTitleId.value)
          titleLegacy <-
            sql"SELECT ${ids.wireReference(Entity.GameTitles, titleId)}".query[String].unique
          lockKey = s"momo:map_masters:$titleLegacy:display_order"
          // The allocation needs a new READ COMMITTED snapshot after any lock wait.
          _ <- sql"SELECT pg_advisory_xact_lock(hashtext($lockKey)::bigint)".query[Unit].unique
          row <- sql"""
          INSERT INTO map_masters (${ids.idColumns}, game_title_id, name, display_order, created_at)
          SELECT $newId, $titleId, ${map.name}, COALESCE(MAX(display_order), 0) + 1, ${map.createdAt}
          FROM map_masters WHERE game_title_id = $titleId
          RETURNING ${ids.wireId("map_masters")}, ${ids.wireReference(
              Entity.GameTitles,
              fr"map_masters.game_title_id"
            )}, name, display_order, created_at
        """.query[MapMasterRow].unique
          _ <- refreshAchievements(row.gameTitleId)
        yield fromRow(row)).exceptSomeSqlState {
          case state if isUniqueViolation(state) =>
            conflict(s"map_master already exists: ${map.id.value} or ${map.name}")
          case state if isForeignKeyViolation(state) =>
            appError(AppError.NotFound("game_title", map.gameTitleId.value))
        }

      override def update(map: MapMaster): ConnectionIO[Unit] = sql"""
        UPDATE map_masters
        SET name = ${map.name}
        WHERE id = ${ids.lookup(Entity.MapMasters, map.id.value)}
      """.update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("map master", map.id.value)
      }.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict(s"map_master already exists: ${map.id.value} or ${map.name}")
      }

      override def delete(id: MapMasterId): ConnectionIO[Unit] = (for
        title <-
          sql"SELECT ${ids.wireReference(Entity.GameTitles, fr"game_title_id")} FROM map_masters WHERE id = ${ids.lookup(Entity.MapMasters, id.value)} FOR UPDATE"
            .query[GameTitleId].option
        deletedDrafts <-
          deleteDiscardedDrafts(fr"map_master_id = ${ids.lookup(Entity.MapMasters, id.value)}")
        deleted <-
          sql"DELETE FROM map_masters WHERE id = ${ids.lookup(Entity.MapMasters, id.value)}".update.run
        _ <- deleted match
          case 1 => ().pure[ConnectionIO]
          case _ => notFound("map master", id.value)
        _ <- title.traverse_(refreshAchievements)
        _ <- PostgresResultNotificationCancellation.afterDeletion(deletedDrafts, Nil)
      yield ()).exceptSomeSqlState {
        case state if isForeignKeyViolation(state) => conflict("map master is still referenced.")
      }

  private def refreshAchievements(title: GameTitleId)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    if ids == PostgresIdentities.Legacy then ().pure[ConnectionIO]
    else
      PostgresAchievementRetirementOps.state(title, lock = true) *>
        sql"SELECT EXISTS(SELECT 1 FROM achievement_items WHERE game_title_id = ${ids.lookup(Entity.GameTitles, title.value)})"
          .query[Boolean].unique.flatMap {
            case true => PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(title))
            case false => ().pure[ConnectionIO]
          }

end PostgresMapMasters

final class PostgresMapMastersRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends MapMastersRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: MapMastersRepository[F] = MapMastersRepository
    .fromAlg(PostgresMapMasters.alg, transactor.trans)

  export delegate.*
end PostgresMapMastersRepository
