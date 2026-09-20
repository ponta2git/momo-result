package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers,
  IncidentCounts,
  ManYen,
  MatchNoInEvent,
  MatchNote,
  MatchNoteBody,
  MatchNoteVersion,
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
      noteBody: Option[String],
      noteVersion: Long,
      noteUpdatedByAccountId: Option[AccountId],
      noteUpdatedAt: Option[Instant],
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
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
  )

  protected val selectMatch = fr"""SELECT
           id, held_event_id, match_no_in_event,
           game_title_id, layout_family, season_master_id,
           owner_member_id, map_master_id, played_at,
           total_assets_draft_id, revenue_draft_id, incident_log_draft_id,
           created_by_account_id, created_by_member_id, created_at,
           note_body, note_version, note_updated_by_account_id, note_updated_at
         FROM matches"""

  protected final def toRecord(
      m: MatchRow,
      players: FourPlayers,
  ): Either[PostgresDataIntegrityException, MatchRecord] =
    val decoded =
      for
        body <- m.noteBody.traverse(MatchNoteBody.fromRequiredString)
        version <- MatchNoteVersion.fromLong(m.noteVersion)
        note <- MatchNote.persisted(body, version, m.noteUpdatedByAccountId, m.noteUpdatedAt)
      yield MatchRecord(
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
        note = note,
      )
    decoded.leftMap(message =>
      PostgresDataIntegrityException
        .inconsistentRow("matches", m.id.value, message)
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
        result <- assemble(matchIds, playerRows, incidentRows).liftTo[ConnectionIO]
      yield result

  protected final def assemble(
      matchIds: List[MatchId],
      playerRows: List[PlayerRow],
      incidentRows: List[IncidentRow],
  ): Either[PostgresDataIntegrityException, Map[MatchId, FourPlayers]] =
    val incidents = incidentRows.groupMap(row => (row.matchId, row.memberId))(identity)
      .view.mapValues(_.flatMap(row =>
        IncidentKindMapping.kindOf(row.incidentMasterId).map(_ -> row.count)
      ).toMap).toMap
    val playersByMatch = playerRows.groupMap(_.matchId) { row =>
      PlayerResult(
        memberId = row.memberId,
        playOrder = row.playOrder,
        rank = row.rank,
        totalAssetsManYen = row.totalAssets,
        revenueManYen = row.revenue,
        incidents =
          IncidentCounts.fromKindMap(incidents.getOrElse((row.matchId, row.memberId), Map.empty)),
      )
    }
    matchIds.traverse { id =>
      FourPlayers.fromTrustedRow(playersByMatch.getOrElse(id, Nil))
        .leftMap(errors =>
          PostgresDataIntegrityException.inconsistentRow(
            "match_players",
            id.value,
            errors.toChain.toList.map(_.message).mkString("; "),
          )
        ).map(id -> _)
    }.map(_.toMap)
