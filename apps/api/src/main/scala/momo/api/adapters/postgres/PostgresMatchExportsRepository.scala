package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{FourPlayers, MatchExportContext, MatchExportRow}
import momo.api.repositories.{MatchExportsAlg, MatchExportsRepository}

private[api] object PostgresMatchExports extends PostgresMatchesReadSupport:
  private final case class ExportMatchRow(id: MatchId, context: MatchExportContext)

  val alg: MatchExportsAlg[ConnectionIO] = new MatchExportsAlg[ConnectionIO]:
    override def project(
        selection: MatchExportsRepository.Selection
    ): ConnectionIO[List[MatchExportRow]] =
      val conditions = List(
        selection.heldEventId.map(id => fr"held_event_id = $id"),
        selection.seasonMasterId.map(id => fr"season_master_id = $id"),
        selection.matchId.map(id => fr"id = $id"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      // Select the bounded export first, then rank full histories only for its titles. Ranking
      // selected rows alone would reset season/title numbers when exporting a single match.
      val select =
        fr"""
        WITH selected_matches AS MATERIALIZED (
          SELECT id, game_title_id
          FROM matches
      """ ++ where ++ fr"""
          ORDER BY played_at DESC, created_at DESC
          LIMIT ${selection.limit}
        ), ranked_matches AS (
          SELECT
            id,
            held_event_id,
            match_no_in_event,
            season_master_id,
            owner_member_id,
            map_master_id,
            played_at,
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
          WHERE game_title_id IN (SELECT game_title_id FROM selected_matches)
        )
        SELECT
          r.id,
          s.name,
          r.season_sequence,
          owner.display_name,
          map.name,
          r.played_at,
          r.game_title_sequence
        FROM ranked_matches r
        JOIN season_masters s ON s.id = r.season_master_id
        JOIN map_masters map ON map.id = r.map_master_id
        JOIN members owner ON owner.id = r.owner_member_id
        WHERE r.id IN (SELECT id FROM selected_matches)
        ORDER BY
          date_trunc('milliseconds', r.played_at),
          r.held_event_id COLLATE "C",
          r.match_no_in_event,
          r.id COLLATE "C"
      """

      for
        // The ranked parent selection and batched children must describe the same match revision.
        _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
        rows <- select.query[ExportMatchRow].to[List]
        playersByMatch <- loadPlayersBatch(rows.map(_.id))
        memberIds =
          playersByMatch.valuesIterator.flatMap(_.toList.map(_.memberId.value)).toSet.toArray
        names <- if memberIds.isEmpty then Map.empty[MemberId, String].pure[ConnectionIO]
        else
          sql"SELECT id, display_name FROM members WHERE id = ANY($memberIds)"
            .query[(MemberId, String)].to[List].map(_.toMap)
        projected <- rows.traverse(row =>
          toProjection(row, playersByMatch.get(row.id), names)
        ).liftTo[ConnectionIO]
      yield projected.flatten

  private def toProjection(
      row: ExportMatchRow,
      players: Option[FourPlayers],
      names: Map[MemberId, String],
  ): Either[PostgresDataIntegrityException, List[MatchExportRow]] =
    players.toRight(PostgresDataIntegrityException
      .inconsistentRow("matches", row.id.value, "export projection has no player rows"))
      .flatMap(_.byPlayOrder.traverse(player =>
        names.get(player.memberId)
          .toRight(PostgresDataIntegrityException.inconsistentRow(
            "members",
            player.memberId.value,
            "export name is missing"
          ))
          .map(name => row.context.row(player, name))
      ))

end PostgresMatchExports

final class PostgresMatchExportsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchExportsRepository[F]:
  private val delegate = MatchExportsRepository
    .fromAlg(PostgresMatchExports.alg, transactor.trans)

  export delegate.*

end PostgresMatchExportsRepository
