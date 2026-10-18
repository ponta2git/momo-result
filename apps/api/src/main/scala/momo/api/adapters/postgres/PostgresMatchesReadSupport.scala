package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
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
      incidentKey: String,
      count: Int,
  )

  protected def selectMatch(using ids: PostgresIdentities) = fr"""SELECT
           ${ids.wireId("matches")}, ${ids.wireReference(
      Entity.HeldEvents,
      fr"matches.held_event_id"
    )}, match_no_in_event,
           ${ids.wireReference(
      Entity.GameTitles,
      fr"matches.game_title_id"
    )}, layout_family, ${ids.wireReference(Entity.SeasonMasters, fr"matches.season_master_id")},
           ${ids.wireReference(
      Entity.Members,
      fr"matches.owner_member_id"
    )}, ${ids.wireReference(Entity.MapMasters, fr"matches.map_master_id")}, played_at,
           matches.total_assets_draft_id,
           matches.revenue_draft_id,
           matches.incident_log_draft_id,
           ${ids.wireReference(Entity.Accounts, fr"matches.created_by_account_id")},
           ${ids.wireReference(Entity.Members, fr"matches.created_by_member_id")}, created_at,
           note_body, note_version, ${ids.wireReference(
      Entity.Accounts,
      fr"matches.note_updated_by_account_id"
    )}, note_updated_at
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
  protected final def loadPlayersBatch(matchIds: List[MatchId])(using ids: PostgresIdentities)
      : ConnectionIO[Map[MatchId, FourPlayers]] =
    if matchIds.isEmpty then Map.empty[MatchId, FourPlayers].pure[ConnectionIO]
    else
      val nativeIds = ids.lookupArray(Entity.Matches, matchIds.map(_.value))
      val playersIO = sql"""
          SELECT ${ids.wireReference(
          Entity.Matches,
          fr"match_players.match_id"
        )}, ${ids.wireReference(
          Entity.Members,
          fr"match_players.member_id"
        )}, play_order, rank, total_assets_man_yen, revenue_man_yen
          FROM match_players
          WHERE match_id = ANY($nativeIds)
          ORDER BY ${ids.wireReference(Entity.Matches, fr"match_players.match_id")}, play_order
        """.query[PlayerRow].to[List]

      val incidentsIO = sql"""
          SELECT ${ids.wireReference(
          Entity.Matches,
          fr"mi.match_id"
        )}, ${ids.wireReference(Entity.Members, fr"mi.member_id")}, im.key, mi.count
          FROM match_incidents mi
          JOIN incident_masters im ON im.id = mi.incident_master_id
          WHERE mi.match_id = ANY($nativeIds)
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
    incidentRows.traverse { row =>
      IncidentKindMapping.kindOf(row.incidentKey).toRight(
        PostgresDataIntegrityException.inconsistentRow(
          "match_incidents",
          row.matchId.value,
          "unknown incident semantic key",
        )
      ).map(kind => ((row.matchId, row.memberId), (kind, row.count)))
    }.flatMap { keyed =>
      val incidents = keyed.groupMap(_._1)(_._2).view.mapValues(_.toMap).toMap
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
    }
