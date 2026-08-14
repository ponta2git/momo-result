package momo.api.adapters.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.FourPlayers
import momo.api.domain.ids.*
import momo.api.repositories.{MatchExportsAlg, MatchExportsRepository}

private object PostgresMatchExports extends PostgresMatchesReadSupport:
  private final case class ExportMatchRow(
      id: MatchId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: java.time.Instant,
      seasonSequence: Int,
      gameTitleSequence: Int,
  )

  val alg: MatchExportsAlg[ConnectionIO] = new MatchExportsAlg[ConnectionIO]:
    override def project(
        selection: MatchExportsRepository.Selection
    ): ConnectionIO[List[MatchExportsRepository.ProjectedMatch]] =
      val conditions = List(
        selection.heldEventId.map(id => fr"held_event_id = $id"),
        selection.seasonMasterId.map(id => fr"season_master_id = $id"),
        selection.matchId.map(id => fr"id = $id"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      val select =
        fr"""
        WITH ranked_matches AS (
          SELECT
            id,
            held_event_id,
            match_no_in_event,
            season_master_id,
            owner_member_id,
            map_master_id,
            played_at,
            created_at,
            CAST(ROW_NUMBER() OVER (
              PARTITION BY season_master_id
              ORDER BY
                date_trunc('milliseconds', played_at),
                held_event_id COLLATE "C",
                match_no_in_event,
                id COLLATE "C"
            ) AS integer) AS season_sequence,
            CAST(ROW_NUMBER() OVER (
              PARTITION BY game_title_id
              ORDER BY
                date_trunc('milliseconds', played_at),
                held_event_id COLLATE "C",
                match_no_in_event,
                id COLLATE "C"
            ) AS integer) AS game_title_sequence
          FROM matches
        ), export_selected AS (
          SELECT *
          FROM ranked_matches
      """ ++ where ++ fr"""
          ORDER BY played_at DESC, created_at DESC
          LIMIT ${selection.limit}
        )
        SELECT
          id,
          season_master_id,
          owner_member_id,
          map_master_id,
          played_at,
          season_sequence,
          game_title_sequence
        FROM export_selected
        ORDER BY
          date_trunc('milliseconds', played_at),
          held_event_id COLLATE "C",
          match_no_in_event,
          id COLLATE "C"
      """

      for
        rows <- select.query[ExportMatchRow].to[List]
        playersByMatch <- loadPlayersBatch(rows.map(_.id))
        projected <- rows.traverse(row => toProjection(row, playersByMatch.get(row.id)))
      yield projected

  private def toProjection(
      row: ExportMatchRow,
      players: Option[FourPlayers],
  ): ConnectionIO[MatchExportsRepository.ProjectedMatch] = players match
    case Some(value) => MatchExportsRepository.ProjectedMatch(
        id = row.id,
        seasonMasterId = row.seasonMasterId,
        ownerMemberId = row.ownerMemberId,
        mapMasterId = row.mapMasterId,
        playedAt = row.playedAt,
        seasonSequence = row.seasonSequence,
        gameTitleSequence = row.gameTitleSequence,
        players = value,
      ).pure[ConnectionIO]
    case None => MonadThrow[ConnectionIO].raiseError(
        PostgresDataIntegrityException
          .inconsistentRow("matches", row.id.value, "export projection has no player rows")
      )

end PostgresMatchExports

final class PostgresMatchExportsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchExportsRepository[F]:
  private val delegate = MatchExportsRepository
    .fromAlg(PostgresMatchExports.alg, Database.transactK(transactor))

  export delegate.*

end PostgresMatchExportsRepository
