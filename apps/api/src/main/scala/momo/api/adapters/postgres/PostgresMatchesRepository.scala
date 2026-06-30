package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMatchInsertOps.{insertMatchCascade, replaceMatchChildren}
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers,
  IncidentCounts,
  IncidentKind,
  ManYen,
  MatchNoInEvent,
  MatchRecord,
  PlayOrder,
  PlayerResult,
  Rank
}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{MatchesAlg, MatchesRepository}

/**
 * Persists `matches` along with their dependent `match_players` (4 rows) and `match_incidents` (4 ×
 * 6 = 24 rows) atomically in a single connection. List/find load player rows in batch (single SQL
 * regardless of result cardinality) to avoid N+1.
 */
object PostgresMatches:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  private def notFound[A](resource: String, id: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.NotFound(resource, id)))

  private final case class MatchRow(
      id: MatchId,
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      gameTitleId: GameTitleId,
      layoutFamily: String,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      totalAssetsDraftId: Option[OcrDraftId],
      revenueDraftId: Option[OcrDraftId],
      incidentLogDraftId: Option[OcrDraftId],
      createdByAccountId: AccountId,
      createdByMemberId: Option[MemberId],
      createdAt: Instant,
      updatedAt: Instant,
  )

  private final case class PlayerRow(
      matchId: MatchId,
      memberId: MemberId,
      playOrder: PlayOrder,
      rank: Rank,
      totalAssets: ManYen,
      revenue: ManYen,
  )

  private final case class IncidentRow(
      matchId: MatchId,
      memberId: MemberId,
      incidentMasterId: IncidentMasterId,
      count: Int,
  )

  private final case class HeldEventMatchCountRow(
      heldEventId: HeldEventId,
      count: Int,
  )

  private val selectMatch = fr"""SELECT
           id, held_event_id, match_no_in_event,
           game_title_id, layout_family, season_master_id,
           owner_member_id, map_master_id, played_at,
           total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
           created_by_account_id, created_by_member_id, created_at, updated_at
         FROM matches"""

  private def toRecord(m: MatchRow, players: FourPlayers): MatchRecord = MatchRecord(
    id = m.id,
    heldEventId = m.heldEventId,
    matchNoInEvent = m.matchNoInEvent,
    gameTitleId = m.gameTitleId,
    layoutFamily = m.layoutFamily,
    seasonMasterId = m.seasonMasterId,
    ownerMemberId = m.ownerMemberId,
    mapMasterId = m.mapMasterId,
    playedAt = m.playedAt,
    totalAssetsDraftId = m.totalAssetsDraftId,
    revenueDraftId = m.revenueDraftId,
    incidentLogDraftId = m.incidentLogDraftId,
    players = players,
    createdByAccountId = m.createdByAccountId,
    createdByMemberId = m.createdByMemberId,
    createdAt = m.createdAt,
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
        """.query[PlayerRow].to[List]

      val incidentsIO = sql"""
          SELECT match_id, member_id, incident_master_id, count
          FROM match_incidents
          WHERE match_id = ANY($ids)
        """.query[IncidentRow].to[List]

      for
        playerRows <- playersIO
        incidentRows <- incidentsIO
        result <- assemble(matchIds, playerRows, incidentRows)
      yield result

  private def assemble(
      matchIds: List[MatchId],
      playerRows: List[PlayerRow],
      incidentRows: List[IncidentRow],
  ): ConnectionIO[Map[MatchId, FourPlayers]] =
    val incidentsByMatch: Map[MatchId, Map[MemberId, Map[IncidentKind, Int]]] = incidentRows
      .groupBy(_.matchId).view.mapValues { rows =>
        rows.groupBy(_.memberId).view.mapValues { rs =>
          rs.iterator.flatMap(r => IncidentKindMapping.kindOf(r.incidentMasterId).map(_ -> r.count))
            .toMap
        }.toMap
      }.toMap

    val playersByMatch: Map[MatchId, List[PlayerResult]] = playerRows.groupBy(_.matchId).view
      .mapValues { rows =>
        val byMember = incidentsByMatch.getOrElse(rows.head.matchId, Map.empty)
        rows.map { row =>
          val ic = byMember.getOrElse(row.memberId, Map.empty)
          PlayerResult(
            memberId = row.memberId,
            playOrder = row.playOrder,
            rank = row.rank,
            totalAssetsManYen = row.totalAssets,
            revenueManYen = row.revenue,
            incidents = IncidentCounts.fromKindMap(ic),
          )
        }
      }.toMap

    matchIds.traverse { mid =>
      val players = playersByMatch.getOrElse(mid, Nil)
      FourPlayers.fromTrustedRow(players) match
        case Right(fp) => (mid -> fp).pure[ConnectionIO]
        case Left(errs) => MonadThrow[ConnectionIO]
            .raiseError[(MatchId, FourPlayers)](PostgresDataIntegrityException
              .inconsistentRow(
                "match_players",
                mid.value,
                errs.toChain.toList.map(_.message).mkString("; "),
              ))
    }.map(_.toMap)

  val alg: MatchesAlg[ConnectionIO] = new MatchesAlg[ConnectionIO]:
    override def create(record: MatchRecord): ConnectionIO[Unit] =
      insertMatchCascade(record, record.createdAt).exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
      }

    override def update(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
      val updateMatch = sql"""
        UPDATE matches
        SET held_event_id = ${record.heldEventId},
            match_no_in_event = ${record.matchNoInEvent},
            game_title_id = ${record.gameTitleId},
            layout_family = ${record.layoutFamily},
            season_master_id = ${record.seasonMasterId},
            owner_member_id = ${record.ownerMemberId},
            map_master_id = ${record.mapMasterId},
            played_at = ${record.playedAt},
            total_assets_draft_id = ${record.totalAssetsDraftId},
            revenue_draft_id = ${record.revenueDraftId},
            incident_log_draft_id = ${record.incidentLogDraftId},
            updated_at = $updatedAt
        WHERE id = ${record.id}
      """.update.run
      updateMatch.flatMap {
        case 1 => replaceMatchChildren(record)
        case _ => notFound[Unit]("match", record.id.value)
      }.exceptSomeSqlState {
        case state if isUniqueViolation(state) =>
          conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
              .toString} already exists for held event ${record.heldEventId.value}.")
      }

    override def delete(id: MatchId): ConnectionIO[Boolean] =
      for
        _ <- sql"DELETE FROM match_drafts WHERE confirmed_match_id = $id".update.run
        deleted <- sql"DELETE FROM matches WHERE id = $id".update.run.map(_ > 0)
      yield deleted

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
        filter.matchId.map(id => fr"id = $id"),
      ).flatten
      val where = fragments.whereAndOpt(conditions)
      val limit = filter.limit.map(n => fr"LIMIT $n").getOrElse(Fragment.empty)
      for
        rows <- (selectMatch ++ where ++ fr"ORDER BY played_at DESC, created_at DESC" ++ limit)
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_.id))
      yield rows.flatMap(r => byMid.get(r.id).map(p => toRecord(r, p)))

    override def listByHeldEvent(heldEventId: HeldEventId): ConnectionIO[List[MatchRecord]] =
      for
        rows <-
        (selectMatch ++ fr"WHERE held_event_id = $heldEventId" ++ fr"ORDER BY match_no_in_event")
          .query[MatchRow].to[List]
        byMid <- loadPlayersBatch(rows.map(_.id))
      yield rows.flatMap(r => byMid.get(r.id).map(p => toRecord(r, p)))

    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
    ): ConnectionIO[Boolean] = sql"""
        SELECT EXISTS (
          SELECT 1 FROM matches
          WHERE held_event_id = $heldEventId AND match_no_in_event = $matchNoInEvent
        )
      """.query[Boolean].unique

    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
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
          """.query[HeldEventMatchCountRow].to[List].map { rows =>
          val seen = rows.map(row => row.heldEventId -> row.count).toMap
          heldEventIds.map(id => id -> seen.getOrElse(id, 0)).toMap
        }
end PostgresMatches

/** Backwards-compatible class facade. */
final class PostgresMatchesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchesRepository[F]:
  private val delegate: MatchesRepository[F] = MatchesRepository
    .fromAlg(PostgresMatches.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchesRepository
