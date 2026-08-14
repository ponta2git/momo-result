package momo.api.adapters.postgres

import java.time.Instant

import cats.data.NonEmptyList
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
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
import momo.api.repositories.MatchListReadModel

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

  protected final case class CursorRow(
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
      statusPriority: Int,
      matchNoIsNull: Boolean,
      matchNoSort: Int,
  ):
    def row: Row = Row(
      kind = kind,
      id = id,
      matchId = matchId,
      matchDraftId = matchDraftId,
      status = status,
      heldEventId = heldEventId,
      matchNoInEvent = matchNoInEvent,
      gameTitleId = gameTitleId,
      seasonMasterId = seasonMasterId,
      mapMasterId = mapMasterId,
      ownerMemberId = ownerMemberId,
      playedAt = playedAt,
      createdAt = createdAt,
      updatedAt = updatedAt,
      heldAtSort = heldAtSort,
    )

    def position: MatchListReadModel.CursorPosition = MatchListReadModel.CursorPosition(
      statusPriority = statusPriority,
      updatedAt = updatedAt,
      heldAt = heldAtSort,
      matchNoIsNull = matchNoIsNull,
      matchNoSort = matchNoSort,
      kind = kind,
      id = id,
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
    case DraftPersisted extends StatusColumn(fr"d.status")
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
    d.status AS status,
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
  FROM match_drafts d
  LEFT JOIN held_events he ON he.id = d.held_event_id"""

  protected final def sortable(select: Fragment): Fragment =
    fr"""SELECT
      combined.*,
      CASE combined.status
        WHEN 'ocr_running' THEN 0
        WHEN 'needs_review' THEN 1
        WHEN 'draft_ready' THEN 2
        WHEN 'ocr_failed' THEN 4
        WHEN 'confirmed' THEN 5
        ELSE 3
      END AS status_priority,
      (combined.match_no_in_event IS NULL) AS match_no_is_null,
      COALESCE(combined.match_no_in_event, 2147483647)::int AS match_no_sort
    FROM (""" ++ select ++ fr") AS combined"

  private final case class SortTerm(
      column: Fragment,
      value: Fragment,
      ascending: Boolean,
  )

  protected final def cursorBoundary(
      sort: MatchListSort,
      cursor: MatchListReadModel.Cursor,
  ): Option[Fragment] = cursor.position.map { position =>
    val terms = sortTerms(sort, position)
    val branches = terms.indices.toList.map { index =>
      val prefix = terms.take(index).map(term => term.column ++ fr" = " ++ term.value)
      val term = terms(index)
      val later = cursor.direction == MatchListReadModel.CursorDirection.After
      val greater = if later then term.ascending else !term.ascending
      val comparison = term.column ++ (if greater then fr" > " else fr" < ") ++ term.value
      fragments.and(NonEmptyList.fromListUnsafe(prefix :+ comparison))
    }
    fr"(" ++ branches.intercalate(fr" OR ") ++ fr")"
  }

  protected final def cursorOrderBy(
      sort: MatchListSort,
      direction: MatchListReadModel.CursorDirection,
  ): Fragment =
    val reverse = direction == MatchListReadModel.CursorDirection.Before
    def ordering(ascending: Boolean): Fragment =
      if ascending != reverse then fr"ASC" else fr"DESC"
    val statusPriority = fr"sortable.status_priority " ++ ordering(ascending = true)
    val updatedAt = fr"sortable.updated_at " ++ ordering(ascending = false)
    val heldAt = fr"sortable.held_at_sort " ++ ordering(sort == MatchListSort.HeldAsc)
    val matchNoIsNull = fr"sortable.match_no_is_null " ++ ordering(ascending = true)
    val matchNoSort = fr"sortable.match_no_sort " ++ ordering(ascending = true)
    val kind = fr"sortable.kind " ++ ordering(ascending = true)
    val id = fr"sortable.id " ++ ordering(ascending = true)
    sort match
      case MatchListSort.StatusPriority =>
        fr"ORDER BY " ++ statusPriority ++ fr", " ++ updatedAt ++ fr", " ++ kind ++ fr", " ++ id
      case MatchListSort.UpdatedDesc =>
        fr"ORDER BY " ++ updatedAt ++ fr", " ++ kind ++ fr", " ++ id
      case MatchListSort.HeldDesc | MatchListSort.HeldAsc =>
        fr"ORDER BY " ++ heldAt ++ fr", " ++ updatedAt ++ fr", " ++ kind ++ fr", " ++ id
      case MatchListSort.MatchNoAsc =>
        fr"ORDER BY " ++ matchNoIsNull ++ fr", " ++ matchNoSort ++ fr", " ++ updatedAt ++
          fr", " ++ kind ++ fr", " ++ id

  private def sortTerms(
      sort: MatchListSort,
      position: MatchListReadModel.CursorPosition,
  ): List[SortTerm] =
    val statusPriority =
      SortTerm(fr"sortable.status_priority", fr"${position.statusPriority}", true)
    val updatedAt = SortTerm(fr"sortable.updated_at", fr"${position.updatedAt}", false)
    val heldAt = SortTerm(
      fr"sortable.held_at_sort",
      fr"${position.heldAt}",
      sort == MatchListSort.HeldAsc,
    )
    val matchNoIsNull =
      SortTerm(fr"sortable.match_no_is_null", fr"${position.matchNoIsNull}", true)
    val matchNoSort = SortTerm(fr"sortable.match_no_sort", fr"${position.matchNoSort}", true)
    val kind = SortTerm(fr"sortable.kind", fr"${position.kind}", true)
    val id = SortTerm(fr"sortable.id", fr"${position.id}", true)
    sort match
      case MatchListSort.StatusPriority => List(statusPriority, updatedAt, kind, id)
      case MatchListSort.UpdatedDesc => List(updatedAt, kind, id)
      case MatchListSort.HeldDesc | MatchListSort.HeldAsc => List(heldAt, updatedAt, kind, id)
      case MatchListSort.MatchNoAsc => List(matchNoIsNull, matchNoSort, updatedAt, kind, id)

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
