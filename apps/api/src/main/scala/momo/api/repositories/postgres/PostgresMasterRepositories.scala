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
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  GameTitlesAlg, GameTitlesRepository, IncidentMastersAlg, IncidentMastersRepository, MapMastersAlg,
  MapMastersRepository, MemberAliasesAlg, MemberAliasesRepository, SeasonMastersAlg,
  SeasonMastersRepository,
}

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
      """.update.run.void

    override def update(title: GameTitle): ConnectionIO[Unit] = sql"""
        UPDATE game_titles
        SET name = ${title.name}, layout_family = ${title.layoutFamily}
        WHERE id = ${title.id}
      """.update.run.void

    override def delete(id: GameTitleId): ConnectionIO[Unit] =
      sql"DELETE FROM game_titles WHERE id = $id".update.run.void

    override def nextDisplayOrder: ConnectionIO[Int] =
      sql"SELECT COALESCE(MAX(display_order), 0) + 1 FROM game_titles".query[Int].unique
end PostgresGameTitles

final class PostgresGameTitlesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends GameTitlesRepository[F]:
  private val delegate: GameTitlesRepository[F] = GameTitlesRepository
    .fromConnectionIO(PostgresGameTitles.alg, Database.transactK(transactor))

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
      """.update.run.void

    override def update(map: MapMaster): ConnectionIO[Unit] = sql"""
        UPDATE map_masters
        SET name = ${map.name}
        WHERE id = ${map.id}
      """.update.run.void

    override def delete(id: MapMasterId): ConnectionIO[Unit] =
      sql"DELETE FROM map_masters WHERE id = $id".update.run.void

    override def nextDisplayOrder(gameTitleId: GameTitleId): ConnectionIO[Int] = sql"""
        SELECT COALESCE(MAX(display_order), 0) + 1
        FROM map_masters
        WHERE game_title_id = $gameTitleId
      """.query[Int].unique
end PostgresMapMasters

final class PostgresMapMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MapMastersRepository[F]:
  private val delegate: MapMastersRepository[F] = MapMastersRepository
    .fromConnectionIO(PostgresMapMasters.alg, Database.transactK(transactor))

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
      """.update.run.void

    override def update(season: SeasonMaster): ConnectionIO[Unit] = sql"""
        UPDATE season_masters
        SET name = ${season.name}
        WHERE id = ${season.id}
      """.update.run.void

    override def delete(id: SeasonMasterId): ConnectionIO[Unit] =
      sql"DELETE FROM season_masters WHERE id = $id".update.run.void

    override def nextDisplayOrder(gameTitleId: GameTitleId): ConnectionIO[Int] = sql"""
        SELECT COALESCE(MAX(display_order), 0) + 1
        FROM season_masters
        WHERE game_title_id = $gameTitleId
      """.query[Int].unique
end PostgresSeasonMasters

final class PostgresSeasonMastersRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SeasonMastersRepository[F]:
  private val delegate: SeasonMastersRepository[F] = SeasonMastersRepository
    .fromConnectionIO(PostgresSeasonMasters.alg, Database.transactK(transactor))

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
    .fromConnectionIO(PostgresIncidentMasters.alg, Database.transactK(transactor))

  export delegate.*
end PostgresIncidentMastersRepository

/**
 * `member_aliases` row.
 *
 * The unique index on `(member_id, alias)` protects against duplicate rows when writes race.
 */
object PostgresMemberAliases:
  final class MemberAliasConflict(message: String) extends RuntimeException(message)

  private[postgres] def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict(message: String): ConnectionIO[Unit] = MonadThrow[ConnectionIO]
    .raiseError[Unit](new MemberAliasConflict(message))

  val alg: MemberAliasesAlg[ConnectionIO] = new MemberAliasesAlg[ConnectionIO]:
    override def list(memberId: Option[MemberId]): ConnectionIO[List[MemberAlias]] =
      val base = fr"SELECT id, member_id, alias, created_at FROM member_aliases"
      val where = memberId.fold(Fragment.empty)(id => fr"WHERE member_id = $id")
      val order = fr"ORDER BY member_id, alias, id"
      (base ++ where ++ order).query[MemberAlias].to[List]

    override def find(id: String): ConnectionIO[Option[MemberAlias]] = sql"""
        SELECT id, member_id, alias, created_at
        FROM member_aliases
        WHERE id = $id
      """.query[MemberAlias].option

    override def create(alias: MemberAlias): ConnectionIO[Unit] = sql"""
        INSERT INTO member_aliases (id, member_id, alias, created_at)
        VALUES (${alias.id}, ${alias.memberId}, ${alias.alias}, ${alias.createdAt})
      """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def update(alias: MemberAlias): ConnectionIO[Unit] = sql"""
        UPDATE member_aliases
        SET member_id = ${alias.memberId}, alias = ${alias.alias}
        WHERE id = ${alias.id}
      """.update.run.void.exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict(s"member alias already exists: ${alias.alias}")
    }

    override def delete(id: String): ConnectionIO[Unit] =
      sql"DELETE FROM member_aliases WHERE id = $id".update.run.void
end PostgresMemberAliases

final class PostgresMemberAliasesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MemberAliasesRepository[F]:
  private val transactK = Database.transactK(transactor)

  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.list(memberId))

  override def find(id: String): F[Option[MemberAlias]] =
    transactK(PostgresMemberAliases.alg.find(id))

  override def create(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.create(alias))

  override def update(alias: MemberAlias): F[Unit] =
    transactK(PostgresMemberAliases.alg.update(alias))

  override def delete(id: String): F[Unit] = transactK(PostgresMemberAliases.alg.delete(id))
end PostgresMemberAliasesRepository
