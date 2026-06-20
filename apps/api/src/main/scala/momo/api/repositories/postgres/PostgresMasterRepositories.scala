package momo.api.repositories.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{
  GameTitle, IncidentMaster, MapMaster, MatchDraftStatus, MemberAlias, SeasonMaster,
}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  GameTitlesAlg, GameTitlesRepository, IncidentMastersAlg, IncidentMastersRepository, MapMastersAlg,
  MapMastersRepository, MemberAliasesAlg, MemberAliasesRepository, SeasonMastersAlg,
  SeasonMastersRepository,
}

private val RestrictViolationSqlState = "23001"

private def isForeignKeyViolation(state: SqlState): Boolean =
  state.value == sqlstate.class23.FOREIGN_KEY_VIOLATION.value ||
    state.value == RestrictViolationSqlState

private def isUniqueViolation(state: SqlState): Boolean = state.value ==
  sqlstate.class23.UNIQUE_VIOLATION.value

private def appError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
  .raiseError[A](new AppException(error))

private def conflict[A](message: String): ConnectionIO[A] = appError(AppError.Conflict(message))

private def notFound[A](resource: String, id: String): ConnectionIO[A] =
  appError(AppError.NotFound(resource, id))

private def deleteDiscardedDrafts(where: Fragment): ConnectionIO[Int] =
  (fr"DELETE FROM match_drafts WHERE" ++ where ++ fr"""
    AND (
      status = ${MatchDraftStatus.Cancelled}
      OR (status = ${MatchDraftStatus.Confirmed} AND confirmed_match_id IS NULL)
    )
  """).update.run

object PostgresGameTitles:

  val alg: GameTitlesAlg[ConnectionIO] = new GameTitlesAlg[ConnectionIO]:
    override def list: ConnectionIO[List[GameTitle]] = sql"""
        SELECT id, name, layout_family, display_order, created_at
        FROM game_titles
        ORDER BY display_order, created_at, id
      """.query[GameTitle].to[List]

    override def find(id: GameTitleId): ConnectionIO[Option[GameTitle]] = sql"""
        SELECT id, name, layout_family, display_order, created_at
        FROM game_titles
        WHERE id = $id
      """.query[GameTitle].option

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
      """.query[GameTitle].unique.exceptSomeSqlState {
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

object PostgresMapMasters:

  val alg: MapMastersAlg[ConnectionIO] = new MapMastersAlg[ConnectionIO]:
    override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[MapMaster]] =
      val base = fr"SELECT id, game_title_id, name, display_order, created_at FROM map_masters"
      val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
      val order = fr"ORDER BY game_title_id, display_order, created_at, id"
      (base ++ where ++ order).query[MapMaster].to[List]

    override def find(id: MapMasterId): ConnectionIO[Option[MapMaster]] = sql"""
        SELECT id, game_title_id, name, display_order, created_at
        FROM map_masters
        WHERE id = $id
      """.query[MapMaster].option

    override def create(map: MapMaster): ConnectionIO[Unit] = sql"""
        INSERT INTO map_masters (id, game_title_id, name, display_order, created_at)
        VALUES (${map.id}, ${map.gameTitleId}, ${map.name}, ${map.displayOrder}, ${map.createdAt})
      """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"map_master already exists: ${map.id.value} or ${map.name}")
      case state if isForeignKeyViolation(state) =>
        appError(AppError.NotFound("game_title", map.gameTitleId.value))
    }

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
      """.query[MapMaster].unique.exceptSomeSqlState {
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
    .fromAlg(PostgresMapMasters.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMapMastersRepository

object PostgresSeasonMasters:

  val alg: SeasonMastersAlg[ConnectionIO] = new SeasonMastersAlg[ConnectionIO]:
    override def list(gameTitleId: Option[GameTitleId]): ConnectionIO[List[SeasonMaster]] =
      val base = fr"SELECT id, game_title_id, name, display_order, created_at FROM season_masters"
      val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
      val order = fr"ORDER BY game_title_id, display_order, created_at, id"
      (base ++ where ++ order).query[SeasonMaster].to[List]

    override def find(id: SeasonMasterId): ConnectionIO[Option[SeasonMaster]] = sql"""
        SELECT id, game_title_id, name, display_order, created_at
        FROM season_masters
        WHERE id = $id
      """.query[SeasonMaster].option

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
      """.query[SeasonMaster].unique.exceptSomeSqlState {
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

/**
 * `member_aliases` row.
 *
 * Alias writes take a transaction-scoped advisory lock so the repository contract can keep OCR name
 * resolution unambiguous even while the DB schema still exposes only per-member uniqueness.
 */
object PostgresMemberAliases:
  private val AliasWriteLockKey = "momo:member_aliases:alias"

  val alg: MemberAliasesAlg[ConnectionIO] = new MemberAliasesAlg[ConnectionIO]:
    override def list(memberId: Option[MemberId]): ConnectionIO[List[MemberAlias]] =
      val base = fr"SELECT id, member_id, alias, created_at FROM member_aliases"
      val where = memberId.fold(Fragment.empty)(id => fr"WHERE member_id = $id")
      val order = fr"ORDER BY member_id, alias, id"
      (base ++ where ++ order).query[MemberAlias].to[List]

    override def find(id: MemberAliasId): ConnectionIO[Option[MemberAlias]] = sql"""
        SELECT id, member_id, alias, created_at
        FROM member_aliases
        WHERE id = $id
      """.query[MemberAlias].option

    override def create(alias: MemberAlias): ConnectionIO[Unit] = (for
      _ <- lockAliasWrites
      _ <- ensureAliasAvailable(alias.alias, excluding = None)
      _ <- sql"""
          INSERT INTO member_aliases (id, member_id, alias, created_at)
          VALUES (${alias.id}, ${alias.memberId}, ${alias.alias}, ${alias.createdAt})
        """.update.run.void
    yield ()).exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def update(alias: MemberAlias): ConnectionIO[Unit] = (for
      _ <- lockAliasWrites
      existing <- find(alias.id)
      _ <- existing.fold(notFound[Unit]("member alias", alias.id.value))(_ => ().pure[ConnectionIO])
      _ <- ensureAliasAvailable(alias.alias, excluding = Some(alias.id))
      _ <- sql"""
          UPDATE member_aliases
          SET member_id = ${alias.memberId}, alias = ${alias.alias}
          WHERE id = ${alias.id}
        """.update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("member alias", alias.id.value)
      }
    yield ()).exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def delete(id: MemberAliasId): ConnectionIO[Unit] =
      sql"DELETE FROM member_aliases WHERE id = $id".update.run.flatMap {
        case 1 => ().pure[ConnectionIO]
        case _ => notFound("member alias", id.value)
      }

  private def lockAliasWrites: ConnectionIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(hashtext($AliasWriteLockKey)::bigint)".query[Unit].unique

  private def ensureAliasAvailable(
      alias: String,
      excluding: Option[MemberAliasId],
  ): ConnectionIO[Unit] =
    val excludingSelf = excluding.fold(Fragment.empty)(id => fr"AND id <> $id")
    (fr"SELECT EXISTS(SELECT 1 FROM member_aliases WHERE alias = $alias" ++ excludingSelf ++ fr")")
      .query[Boolean].unique.flatMap {
        case false => ().pure[ConnectionIO]
        case true => conflict(s"member alias already exists: $alias")
      }
end PostgresMemberAliases

final class PostgresMemberAliasesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MemberAliasesRepository[F]:
  private val transactK = Database.transactK(transactor)

  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.list(memberId))

  override def find(id: MemberAliasId): F[Option[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.find(id))

  override def create(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.create(alias))

  override def update(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.update(alias))

  override def delete(id: MemberAliasId): F[Unit] = transactK(PostgresMemberAliases.alg.delete(id))
end PostgresMemberAliasesRepository
