package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
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

private[postgres] trait PostgresMatchesReadSupport:
  protected final case class MatchRow(
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

  protected final case class PlayerRow(
      matchId: MatchId,
      memberId: MemberId,
      playOrder: PlayOrder,
      rank: Rank,
      totalAssets: ManYen,
      revenue: ManYen,
  )

  protected final case class IncidentRow(
      matchId: MatchId,
      memberId: MemberId,
      incidentMasterId: IncidentMasterId,
      count: Int,
  )

  protected final case class HeldEventMatchStatsRow(
      heldEventId: HeldEventId,
      count: Int,
      maxMatchNo: Int,
  )

  protected val selectMatch = fr"""SELECT
           id, held_event_id, match_no_in_event,
           game_title_id, layout_family, season_master_id,
           owner_member_id, map_master_id, played_at,
           total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
           created_by_account_id, created_by_member_id, created_at, updated_at
         FROM matches"""

  protected final def toRecord(m: MatchRow, players: FourPlayers): MatchRecord = MatchRecord(
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
  protected final def loadPlayersBatch(matchIds: List[MatchId])
      : ConnectionIO[Map[MatchId, FourPlayers]] =
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

  protected final def assemble(
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
