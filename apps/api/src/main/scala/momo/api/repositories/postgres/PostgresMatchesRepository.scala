package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments
import doobie.util.update.Update

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{FourPlayers, IncidentCounts, MatchRecord, PlayerResult}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{MatchesAlg, MatchesRepository}

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection. List/find load player rows in batch (single SQL
 * regardless of result cardinality) to avoid N+1.
 */
object PostgresMatches:

  private type MatchRow = (
      MatchId,
      HeldEventId,
      Int,
      GameTitleId,
      String,
      SeasonMasterId,
      MemberId,
      MapMasterId,
      Instant,
      Option[OcrDraftId],
      Option[OcrDraftId],
      Option[OcrDraftId],
      MemberId,
      Instant,
      Instant,
  )

  private val selectMatch = fr"""SELECT
           id, held_event_id, match_no_in_event,
           game_title_id, layout_family, season_master_id,
           owner_member_id, map_master_id, played_at,
           total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
           created_by_member_id, created_at, updated_at
         FROM matches"""

  private def toRecord(m: MatchRow, players: FourPlayers): MatchRecord = MatchRecord(
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

  /**
   * Batch-load all `match_players` and `match_incidents` rows for the given match ids in two SQL
   * statements total, then assemble per-match `FourPlayers`. This collapses the prior N+1 (1 +
   * 2*N) into a constant-shaped 2 statements regardless of `matchIds.size`.
   */
  private def loadPlayersBatch(matchIds: List[MatchId]): ConnectionIO[Map[MatchId, FourPlayers]] =
    if matchIds.isEmpty then Map.empty[MatchId, FourPlayers].pure[ConnectionIO]
    else
      val ids = matchIds.map(_.value).toArray
      val playersIO = sql"""
          SELECT match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen
          FROM match_players
          WHERE match_id = ANY($ids)
          ORDER BY match_id, play_order
        """.query[(MatchId, MemberId, Int, Int, Int, Int)].to[List]

      val incidentsIO = sql"""
          SELECT match_id, member_id, incident_master_id, count
          FROM match_incidents
          WHERE match_id = ANY($ids)
        """.query[(MatchId, MemberId, IncidentMasterId, Int)].to[List]

      for
        playerRows <- playersIO
        incidentRows <- incidentsIO
        result <- assemble(matchIds, playerRows, incidentRows)
      yield result

  private def assemble(
      matchIds: List[MatchId],
      playerRows: List[(MatchId, MemberId, Int, Int, Int, Int)],
      incidentRows: List[(MatchId, MemberId, IncidentMasterId, Int)],
  ): ConnectionIO[Map[MatchId, FourPlayers]] =
    val incidentsByMatch: Map[MatchId, Map[MemberId, Map[IncidentMasterId, Int]]] = incidentRows
      .groupBy(_._1).view.mapValues { rows =>
        rows.groupBy(_._2).view.mapValues(rs => rs.map(r => r._3 -> r._4).toMap).toMap
      }.toMap

    val playersByMatch: Map[MatchId, List[PlayerResult]] = playerRows.groupBy(_._1).view
      .mapValues { rows =>
        val byMember = incidentsByMatch.getOrElse(rows.head._1, Map.empty)
        rows.map { case (_, memberId, playOrder, rank, totalAssets, revenue) =>
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
      }.toMap

    matchIds.traverse { mid =>
      val players = playersByMatch.getOrElse(mid, Nil)
      FourPlayers.fromTrustedRow(players) match
        case Right(fp) => (mid -> fp).pure[ConnectionIO]
        case Left(errs) => MonadThrow[ConnectionIO]
            .raiseError[(MatchId, FourPlayers)](new IllegalStateException(s"match ${mid
                .value} has invalid match_players row(s): ${errs.toChain.toList.map(_.message)
                .mkString("; ")}"))
    }.map(_.toMap)

  private def insertAll(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
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
          ${record.createdByMemberId}, ${record.createdAt}, $updatedAt
        )
      """.update.run

    val playerRows: List[(MatchId, MemberId, Int, Int, Int, Int, Instant)] = record.players.toList
      .map { p =>
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
      Update[(MatchId, MemberId, Int, Int, Int, Int, Instant)]("""INSERT INTO match_players
         (match_id, member_id, play_order, rank, total_assets_man_yen, revenue_man_yen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)""").updateMany(playerRows)

    val incidentRows: List[(MatchId, MemberId, IncidentMasterId, Int, Instant)] = record.players
      .toList.flatMap { p =>
        p.incidents.entriesByMasterId.map { case (incidentId, count) =>
          (record.id, p.memberId, incidentId, count, record.createdAt)
        }
      }
    val insertIncidents =
      Update[(MatchId, MemberId, IncidentMasterId, Int, Instant)]("""INSERT INTO match_incidents
         (match_id, member_id, incident_master_id, count, created_at)
         VALUES (?, ?, ?, ?, ?)""").updateMany(incidentRows)

    (insertMatch *> insertPlayers *> insertIncidents).void

  val alg: MatchesAlg[ConnectionIO] = new MatchesAlg[ConnectionIO]:
    override def create(record: MatchRecord): ConnectionIO[Unit] =
      insertAll(record, record.createdAt)

    override def update(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
      val deleteMatch = sql"DELETE FROM matches WHERE id = ${record.id}".update.run
      (deleteMatch *> insertAll(record, updatedAt)).void

    override def delete(id: MatchId): ConnectionIO[Boolean] =
      sql"DELETE FROM matches WHERE id = $id".update.run.map(_ > 0)

    override def find(id: MatchId): ConnectionIO[Option[MatchRecord]] =
      (selectMatch ++ fr"WHERE id = $id").query[MatchRow].option.flatMap {
        case None => Option.empty[MatchRecord].pure[ConnectionIO]
        case Some(row) => loadPlayersBatch(List(id))
            .map(byMid => byMid.get(id).map(p => toRecord(row, p)))
      }

    override def list(filter: MatchesRepository.ListFilter): ConnectionIO[List[MatchRecord]] =
      val conditions = List(
        filter.heldEventId.map(id => fr"held_event_id = $id"),
        filter.gameTitleId.map(id => fr"game_title_id = $id"),
        filter.seasonMasterId.map(id => fr"season_master_id = $id"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      val limit = filter.limit.map(n => fr"LIMIT $n").getOrElse(Fragment.empty)
      for
        rows <- (selectMatch ++ where ++ fr"ORDER BY played_at DESC, created_at DESC" ++ limit)
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_._1))
      yield rows.flatMap(r => byMid.get(r._1).map(p => toRecord(r, p)))

    override def listByHeldEvent(heldEventId: HeldEventId): ConnectionIO[List[MatchRecord]] =
      for
        rows <-
        (selectMatch ++ fr"WHERE held_event_id = $heldEventId" ++ fr"ORDER BY match_no_in_event")
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_._1))
      yield rows.flatMap(r => byMid.get(r._1).map(p => toRecord(r, p)))

    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: Int,
    ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = $heldEventId AND match_no_in_event = $matchNoInEvent
        )
      """.query[Boolean].unique

    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: Int,
        excludeMatchId: MatchId,
    ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = $heldEventId
            AND match_no_in_event = $matchNoInEvent
            AND id <> $excludeMatchId
        )
      """.query[Boolean].unique

    override def maxMatchNo(heldEventId: HeldEventId): ConnectionIO[Int] = sql"""
        SELECT COALESCE(MAX(match_no_in_event), 0)
        FROM matches WHERE held_event_id = $heldEventId
      """.query[Int].unique

    override def countByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): ConnectionIO[Map[HeldEventId, Int]] =
      if heldEventIds.isEmpty then Map.empty[HeldEventId, Int].pure[ConnectionIO]
      else
        val ids = heldEventIds.map(_.value).toArray
        sql"""
            SELECT held_event_id, COUNT(*)::int
            FROM matches
            WHERE held_event_id = ANY($ids)
            GROUP BY held_event_id
          """.query[(HeldEventId, Int)].to[List].map { rows =>
          val seen = rows.toMap
          heldEventIds.map(id => id -> seen.getOrElse(id, 0)).toMap
        }
end PostgresMatches

/** Backwards-compatible class facade. */
final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromConnectionIO(PostgresMatches.alg, Database.transactK(transactor))

  override def create(record: MatchRecord): F[Unit] = delegate.create(record)
  override def update(record: MatchRecord, updatedAt: Instant): F[Unit] = delegate
    .update(record, updatedAt)
  override def delete(id: MatchId): F[Boolean] = delegate.delete(id)
  override def find(id: MatchId): F[Option[MatchRecord]] = delegate.find(id)
  override def list(filter: MatchesRepository.ListFilter): F[List[MatchRecord]] = delegate
    .list(filter)
  override def listByHeldEvent(heldEventId: HeldEventId): F[List[MatchRecord]] = delegate
    .listByHeldEvent(heldEventId)
  override def existsMatchNo(heldEventId: HeldEventId, matchNoInEvent: Int): F[Boolean] = delegate
    .existsMatchNo(heldEventId, matchNoInEvent)
  override def existsMatchNoExcept(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      excludeMatchId: MatchId,
  ): F[Boolean] = delegate.existsMatchNoExcept(heldEventId, matchNoInEvent, excludeMatchId)
  override def maxMatchNo(heldEventId: HeldEventId): F[Int] = delegate.maxMatchNo(heldEventId)
  override def countByHeldEvents(heldEventIds: List[HeldEventId]): F[Map[HeldEventId, Int]] =
    delegate.countByHeldEvents(heldEventIds)
end PostgresMatchesRepository
