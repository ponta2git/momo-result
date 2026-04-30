package momo.api.repositories.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.update.Update
import java.time.Instant
import momo.api.domain.{IncidentCounts, MatchRecord, PlayerResult}
import momo.api.repositories.MatchesRepository

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection.
 */
final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:

  private type MatchRow = (
      String, // id
      String, // held_event_id
      Int, // match_no_in_event
      String, // game_title_id
      String, // layout_family
      String, // season_master_id
      String, // owner_member_id
      String, // map_master_id
      Instant, // played_at
      Option[String], // total_assets_draft_id
      Option[String], // revenue_draft_id
      Option[String], // incident_log_draft_id
      String, // created_by_member_id
      Instant, // created_at
      Instant, // updated_at
  )

  private val selectMatch = fr"""SELECT
           id, held_event_id, match_no_in_event,
           game_title_id, layout_family, season_master_id,
           owner_member_id, map_master_id, played_at,
           total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
           created_by_member_id, created_at, updated_at
         FROM matches"""

  private def toRecord(m: MatchRow, players: List[PlayerResult]): MatchRecord = MatchRecord(
    id = m._1,
    heldEventId = m._2,
    matchNoInEvent = m._3,
    gameTitleId = m._4,
    layoutFamily = m._5,
    seasonMasterId = m._6,
    ownerMemberId = m._7,
    mapMasterId = m._8,
    playedAt = m._9,
    totalAssetsDraftId = m._10,
    revenueDraftId = m._11,
    incidentLogDraftId = m._12,
    players = players,
    createdByMemberId = m._13,
    createdAt = m._14,
  )

  private def loadPlayers(matchId: String): ConnectionIO[List[PlayerResult]] =
    val playerRowsIO = sql"""
        SELECT member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
        FROM match_players
        WHERE match_id = $matchId
        ORDER BY play_order
      """.query[(String, Int, Int, Int, Int)].to[List]

    val incidentRowsIO = sql"""
        SELECT member_id, incident_master_id, count
        FROM match_incidents
        WHERE match_id = $matchId
      """.query[(String, String, Int)].to[List]

    for
      players <- playerRowsIO
      incidents <- incidentRowsIO
    yield
      val byMember: Map[String, Map[String, Int]] = incidents.groupBy(_._1).view
        .mapValues(rows => rows.map(r => r._2 -> r._3).toMap).toMap
      players.map { case (memberId, playOrder, rank, totalAssets, revenue) =>
        val ic = byMember.getOrElse(memberId, Map.empty)
        PlayerResult(
          memberId = memberId,
          playOrder = playOrder,
          rank = rank,
          totalAssetsManYen = totalAssets,
          revenueManYen = revenue,
          incidents = IncidentCounts(
            destination = ic.getOrElse(IncidentCounts.IdDestination, 0),
            plusStation = ic.getOrElse(IncidentCounts.IdPlusStation, 0),
            minusStation = ic.getOrElse(IncidentCounts.IdMinusStation, 0),
            cardStation = ic.getOrElse(IncidentCounts.IdCardStation, 0),
            cardShop = ic.getOrElse(IncidentCounts.IdCardShop, 0),
            suriNoGinji = ic.getOrElse(IncidentCounts.IdSuriNoGinji, 0),
          ),
        )
      }

  override def create(record: MatchRecord): F[Unit] =
    val insertMatch = sql"""
        INSERT INTO matches (
          id, held_event_id, match_no_in_event,
          game_title_id, layout_family, season_master_id,
          owner_member_id, map_master_id, played_at,
          total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
          created_by_member_id, created_at, updated_at
        ) VALUES (
          ${record.id}, ${record.heldEventId}, ${record.matchNoInEvent},
          ${record.gameTitleId}, ${record.layoutFamily}, ${record.seasonMasterId},
          ${record.ownerMemberId}, ${record.mapMasterId}, ${record.playedAt},
          ${record.totalAssetsDraftId}, ${record.revenueDraftId}, ${record.incidentLogDraftId},
          ${record.createdByMemberId}, ${record.createdAt}, ${record.createdAt}
        )
      """.update.run

    val playerRows: List[(String, String, Int, Int, Int, Int, Instant)] = record.players.map { p =>
      (
        record.id,
        p.memberId,
        p.playOrder,
        p.rank,
        p.totalAssetsManYen,
        p.revenueManYen,
        record.createdAt,
      )
    }
    val insertPlayers =
      Update[(String, String, Int, Int, Int, Int, Instant)]("""INSERT INTO match_players
         (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)""").updateMany(playerRows)

    val incidentRows: List[(String, String, String, Int, Instant)] = record.players.flatMap { p =>
      p.incidents.entriesByMasterId.map { case (incidentId, count) =>
        (record.id, p.memberId, incidentId, count, record.createdAt)
      }
    }
    val insertIncidents =
      Update[(String, String, String, Int, Instant)]("""INSERT INTO match_incidents
         (match_id, member_id, incident_master_id, count, created_at)
         VALUES (?, ?, ?, ?, ?)""").updateMany(incidentRows)

    (insertMatch *> insertPlayers *> insertIncidents).void.transact(transactor)

  override def find(id: String): F[Option[MatchRecord]] =
    val program: ConnectionIO[Option[MatchRecord]] = (selectMatch ++ fr"WHERE id = $id")
      .query[MatchRow].option.flatMap {
        case None => Option.empty[MatchRecord].pure[ConnectionIO]
        case Some(row) => loadPlayers(id).map(players => Some(toRecord(row, players)))
      }
    program.transact(transactor)

  override def listByHeldEvent(heldEventId: String): F[List[MatchRecord]] =
    val program: ConnectionIO[List[MatchRecord]] =
      for
        rows <-
        (selectMatch ++ fr"WHERE held_event_id = $heldEventId" ++ fr"ORDER BY match_no_in_event")
          .query[MatchRow].to[List]
        out <- rows.traverse(r => loadPlayers(r._1).map(p => toRecord(r, p)))
      yield out
    program.transact(transactor)

  override def existsMatchNo(heldEventId: String, matchNoInEvent: Int): F[Boolean] = sql"""
      SELECT EXISTS (
        SELECT 1 FROM matches
        WHERE held_event_id = $heldEventId AND match_no_in_event = $matchNoInEvent
      )
    """.query[Boolean].unique.transact(transactor)

  override def maxMatchNo(heldEventId: String): F[Int] = sql"""
      SELECT COALESCE(MAX(match_no_in_event), 0)
      FROM matches WHERE held_event_id = $heldEventId
    """.query[Int].unique.transact(transactor)

  override def countByHeldEvents(heldEventIds: List[String]): F[Map[String, Int]] =
    if heldEventIds.isEmpty then Map.empty[String, Int].pure[F]
    else
      val ids = heldEventIds.toArray
      val q = sql"""
          SELECT held_event_id, COUNT(*)::int
          FROM matches
          WHERE held_event_id = ANY($ids)
          GROUP BY held_event_id
        """.query[(String, Int)].to[List]
      q.transact(transactor).map { rows =>
        val seen = rows.toMap
        heldEventIds.map(id => id -> seen.getOrElse(id, 0)).toMap
      }
