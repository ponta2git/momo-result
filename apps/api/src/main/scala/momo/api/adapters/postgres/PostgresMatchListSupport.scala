package momo.api.adapters.postgres

import java.time.Instant

import cats.data.NonEmptyList
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraftStatus,
  MatchListItem,
  MatchListItemKind,
  MatchListRankEntry,
  MatchListSort,
  MatchListSummary,
  MatchNoInEvent,
  PlayOrder,
  Rank
}

private[postgres] trait PostgresMatchListSupport:
  protected final case class Row(
      kind: String,
      id: String,
      matchId: Option[MatchId],
      matchDraftId: Option[MatchDraftId],
      status: String,
      heldEventId: Option[HeldEventId],
      matchNoInEvent: Option[MatchNoInEvent],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
      mapMasterId: Option[MapMasterId],
      ownerMemberId: Option[MemberId],
      playedAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant,
      heldAtSort: Instant,
  )

  protected final case class RankRow(
      matchId: MatchId,
      memberId: MemberId,
      rank: Rank,
      playOrder: PlayOrder,
  ):
    def toEntry: MatchListRankEntry = MatchListRankEntry(memberId, rank, playOrder)

  protected final case class SummaryRow(
      incompleteCount: Int,
      ocrRunningCount: Int,
      preConfirmCount: Int,
      needsReviewCount: Int,
  ):
    def toSummary: MatchListSummary = MatchListSummary(
      incompleteCount = incompleteCount,
      ocrRunningCount = ocrRunningCount,
      preConfirmCount = preConfirmCount,
      needsReviewCount = needsReviewCount,
    )

  protected enum StatusColumn(val fragment: Fragment):
    case DraftComputed extends StatusColumn(fr"d.computed_status")
    case CombinedStatus extends StatusColumn(fr"combined.status")

  protected val confirmedBase = fr"""SELECT
    'match' AS kind,
    m.id AS id,
    m.id AS match_id,
    NULL::text AS match_draft_id,
    'confirmed' AS status,
    m.held_event_id,
    m.match_no_in_event,
    m.game_title_id,
    m.season_master_id,
    m.map_master_id,
    m.owner_member_id,
    m.played_at,
    m.created_at,
    m.updated_at,
    COALESCE(he.start_at, m.played_at, m.updated_at) AS held_at_sort
  FROM matches m
  LEFT JOIN held_events he ON he.id = m.held_event_id"""

  protected val draftBase = fr"""SELECT
    'match_draft' AS kind,
    d.id AS id,
    NULL::text AS match_id,
    d.id AS match_draft_id,
    d.computed_status AS status,
    d.held_event_id,
    d.match_no_in_event,
    d.game_title_id,
    d.season_master_id,
    d.map_master_id,
    d.owner_member_id,
    d.played_at,
    d.created_at,
    d.updated_at,
    COALESCE(he.start_at, d.played_at, d.updated_at) AS held_at_sort
  FROM (
    SELECT
      md.*,
      md.status AS persisted_status,
      CASE
        WHEN md.status <> 'ocr_running' THEN md.status
        WHEN md.total_assets_draft_id IS NULL
          AND md.revenue_draft_id IS NULL
          AND md.incident_log_draft_id IS NULL THEN md.status
        WHEN EXISTS (
          SELECT 1
          FROM unnest(
            ARRAY[md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id]
          ) AS slot(ocr_draft_id)
          LEFT JOIN ocr_jobs j ON j.draft_id = slot.ocr_draft_id
          WHERE slot.ocr_draft_id IS NOT NULL
            AND (j.status IS NULL OR j.status IN ('queued', 'running'))
        ) THEN 'ocr_running'
        WHEN EXISTS (
          SELECT 1
          FROM unnest(
            ARRAY[md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id]
          ) AS slot(ocr_draft_id)
          JOIN ocr_jobs j ON j.draft_id = slot.ocr_draft_id
          WHERE slot.ocr_draft_id IS NOT NULL
            AND j.status IN ('failed', 'cancelled')
        ) THEN 'ocr_failed'
        WHEN EXISTS (
          SELECT 1
          FROM unnest(
            ARRAY[md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id]
          ) AS slot(ocr_draft_id)
          JOIN ocr_drafts od ON od.id = slot.ocr_draft_id
          WHERE slot.ocr_draft_id IS NOT NULL
            AND jsonb_array_length(od.warnings_json) > 0
        ) THEN 'needs_review'
        ELSE 'draft_ready'
      END AS computed_status
    FROM match_drafts md
  ) d
  LEFT JOIN held_events he ON he.id = d.held_event_id"""

  protected final def loadRanks(
      matchIds: List[MatchId]
  ): ConnectionIO[Map[MatchId, List[MatchListRankEntry]]] =
    if matchIds.isEmpty then Map.empty[MatchId, List[MatchListRankEntry]].pure[ConnectionIO]
    else
      val ids = NonEmptyList.fromListUnsafe(matchIds)
      (fr"""
        SELECT match_id, member_id, rank, play_order
        FROM match_players
        WHERE """ ++ fragments.in(fr"match_id", ids) ++ fr"""
        ORDER BY match_id, play_order
      """).query[RankRow].to[List].map { rows =>
        rows.groupBy(_.matchId).view.mapValues(_.map(_.toEntry)).toMap
      }

  protected final def toItem(
      row: Row,
      getRanks: MatchId => List[MatchListRankEntry]
  ): MatchListItem =
    val kind = MatchListItemKind.fromWire(row.kind).getOrElse(MatchListItemKind.Match)
    val ranks = row.matchId.map(getRanks).getOrElse(Nil)
    MatchListItem(
      kind = kind,
      id = row.id,
      matchId = row.matchId,
      matchDraftId = row.matchDraftId,
      status = row.status,
      heldEventId = row.heldEventId,
      matchNoInEvent = row.matchNoInEvent,
      gameTitleId = row.gameTitleId,
      seasonMasterId = row.seasonMasterId,
      mapMasterId = row.mapMasterId,
      ownerMemberId = row.ownerMemberId,
      playedAt = row.playedAt,
      createdAt = row.createdAt,
      updatedAt = row.updatedAt,
      ranks = ranks,
    )

  protected final def statusIn(column: StatusColumn, statuses: Set[MatchDraftStatus]): Fragment =
    val nonEmpty = NonEmptyList.fromListUnsafe(statuses.toList)
    fragments.in(column.fragment, nonEmpty)

  protected final def orderBy(sort: MatchListSort): Fragment =
    val tieBreaker = fr", combined.kind ASC, combined.id ASC"
    sort match
      case MatchListSort.StatusPriority =>
        fr"""ORDER BY
          CASE combined.status
            WHEN 'ocr_running' THEN 0
            WHEN 'needs_review' THEN 1
            WHEN 'draft_ready' THEN 2
            WHEN 'ocr_failed' THEN 4
            WHEN 'confirmed' THEN 5
            ELSE 3
          END ASC,
          combined.updated_at DESC""" ++ tieBreaker
      case MatchListSort.UpdatedDesc => fr"ORDER BY combined.updated_at DESC" ++ tieBreaker
      case MatchListSort.HeldDesc =>
        fr"ORDER BY combined.held_at_sort DESC, combined.updated_at DESC" ++ tieBreaker
      case MatchListSort.HeldAsc =>
        fr"ORDER BY combined.held_at_sort ASC, combined.updated_at DESC" ++ tieBreaker
      case MatchListSort.MatchNoAsc =>
        fr"""ORDER BY
          combined.match_no_in_event IS NULL ASC,
          combined.match_no_in_event ASC,
          combined.updated_at DESC""" ++ tieBreaker
