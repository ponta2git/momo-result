package momo.api.repositories.doobie

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}
import momo.api.repositories.{
  GameTitlesRepository, IncidentMastersRepository, MapMastersRepository, MemberAliasesRepository,
  SeasonMastersRepository,
}

final class DoobieGameTitlesRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends GameTitlesRepository[F]:

  override def list: F[List[GameTitle]] = sql"""
      SELECT id, name, layout_family, display_order, created_at
      FROM game_titles
      ORDER BY display_order, created_at, id
    """.query[GameTitle].to[List].transact(xa)

  override def find(id: String): F[Option[GameTitle]] = sql"""
      SELECT id, name, layout_family, display_order, created_at
      FROM game_titles
      WHERE id = $id
    """.query[GameTitle].option.transact(xa)

  override def create(title: GameTitle): F[Unit] = sql"""
      INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
      VALUES (${title.id}, ${title.name}, ${title.layoutFamily}, ${title.displayOrder}, ${title
      .createdAt})
    """.update.run.void.transact(xa)

  override def nextDisplayOrder: F[Int] =
    sql"SELECT COALESCE(MAX(display_order), 0) + 1 FROM game_titles".query[Int].unique.transact(xa)

final class DoobieMapMastersRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends MapMastersRepository[F]:

  override def list(gameTitleId: Option[String]): F[List[MapMaster]] =
    val base = fr"SELECT id, game_title_id, name, display_order, created_at FROM map_masters"
    val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
    val order = fr"ORDER BY game_title_id, display_order, created_at, id"
    (base ++ where ++ order).query[MapMaster].to[List].transact(xa)

  override def find(id: String): F[Option[MapMaster]] = sql"""
      SELECT id, game_title_id, name, display_order, created_at
      FROM map_masters
      WHERE id = $id
    """.query[MapMaster].option.transact(xa)

  override def create(map: MapMaster): F[Unit] = sql"""
      INSERT INTO map_masters (id, game_title_id, name, display_order, created_at)
      VALUES (${map.id}, ${map.gameTitleId}, ${map.name}, ${map.displayOrder}, ${map.createdAt})
    """.update.run.void.transact(xa)

  override def nextDisplayOrder(gameTitleId: String): F[Int] = sql"""
      SELECT COALESCE(MAX(display_order), 0) + 1
      FROM map_masters
      WHERE game_title_id = $gameTitleId
    """.query[Int].unique.transact(xa)

final class DoobieSeasonMastersRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends SeasonMastersRepository[F]:

  override def list(gameTitleId: Option[String]): F[List[SeasonMaster]] =
    val base = fr"SELECT id, game_title_id, name, display_order, created_at FROM season_masters"
    val where = gameTitleId.fold(Fragment.empty)(id => fr"WHERE game_title_id = $id")
    val order = fr"ORDER BY game_title_id, display_order, created_at, id"
    (base ++ where ++ order).query[SeasonMaster].to[List].transact(xa)

  override def find(id: String): F[Option[SeasonMaster]] = sql"""
      SELECT id, game_title_id, name, display_order, created_at
      FROM season_masters
      WHERE id = $id
    """.query[SeasonMaster].option.transact(xa)

  override def create(season: SeasonMaster): F[Unit] = sql"""
      INSERT INTO season_masters (id, game_title_id, name, display_order, created_at)
      VALUES (${season.id}, ${season.gameTitleId}, ${season.name}, ${season.displayOrder}, ${season
      .createdAt})
    """.update.run.void.transact(xa)

  override def nextDisplayOrder(gameTitleId: String): F[Int] = sql"""
      SELECT COALESCE(MAX(display_order), 0) + 1
      FROM season_masters
      WHERE game_title_id = $gameTitleId
    """.query[Int].unique.transact(xa)

final class DoobieIncidentMastersRepository[F[_]: MonadCancelThrow](xa: Transactor[F])
    extends IncidentMastersRepository[F]:

  override def list: F[List[IncidentMaster]] = sql"""
      SELECT id, key, display_name, display_order, created_at
      FROM incident_masters
      ORDER BY display_order, id
    """.query[IncidentMaster].to[List].transact(xa)

/**
 * `member_aliases` row.
 *
 * The Scala domain `MemberAlias` does not carry the DB-level `id`, so we generate a stable id when
 * inserting. The unique index on `(member_id, alias)` keeps duplicates idempotent via ON CONFLICT.
 */
final class DoobieMemberAliasesRepository[F[_]: MonadCancelThrow](
    xa: Transactor[F],
    nextId: F[String],
) extends MemberAliasesRepository[F]:

  override def list(memberId: Option[String]): F[List[MemberAlias]] =
    val base = fr"SELECT member_id, alias, created_at FROM member_aliases"
    val where = memberId.fold(Fragment.empty)(id => fr"WHERE member_id = $id")
    val order = fr"ORDER BY member_id, alias"
    (base ++ where ++ order).query[MemberAlias].to[List].transact(xa)

  override def create(alias: MemberAlias): F[Unit] = nextId.flatMap { id =>
    sql"""
        INSERT INTO member_aliases (id, member_id, alias, created_at)
        VALUES ($id, ${alias.memberId}, ${alias.alias}, ${alias.createdAt})
        ON CONFLICT (member_id, alias) DO NOTHING
      """.update.run.void.transact(xa)
  }
