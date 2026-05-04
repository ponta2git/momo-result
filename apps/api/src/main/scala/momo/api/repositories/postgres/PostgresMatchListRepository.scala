package momo.api.repositories.postgres

import java.time.Instant

import cats.data.NonEmptyList
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraftStatus, MatchListItem, MatchListItemKind, MatchListRankEntry}
import momo.api.repositories.MatchListRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresMatchListRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchListRepository[F]:

  private type Row = (
      String,
      String,
      Option[MatchId],
      Option[MatchDraftId],
      String,
      Option[HeldEventId],
      Option[Int],
      Option[GameTitleId],
      Option[SeasonMasterId],
      Option[MapMasterId],
      Option[MemberId],
      Option[Instant],
      Instant,
      Instant,
  )
  private val confirmedBase = fr"""SELECT
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
    m.updated_at
  FROM matches m"""

  private val draftBase = fr"""SELECT
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
    d.updated_at
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
  ) d"""

  override def list(filter: MatchListRepository.Filter): F[List[MatchListItem]] =
    val confirmedConditions = List(
      filter.heldEventId.map(v => fr"m.held_event_id = $v"),
      filter.gameTitleId.map(v => fr"m.game_title_id = $v"),
      filter.seasonMasterId.map(v => fr"m.season_master_id = $v"),
    ).flatten
    val confirmedSelect = confirmedBase ++ fragments.whereAndOpt(confirmedConditions)

    val draftConditionsCommon = List(
      filter.heldEventId.map(v => fr"d.held_event_id = $v"),
      filter.gameTitleId.map(v => fr"d.game_title_id = $v"),
      filter.seasonMasterId.map(v => fr"d.season_master_id = $v"),
      Some(fr"d.persisted_status <> ${MatchDraftStatus.Cancelled}"),
      Some(fr"d.persisted_status <> ${MatchDraftStatus.Confirmed}"),
    ).flatten
    val draftStatusCondition = filter.status match
      case MatchListRepository.StatusFilter.All => None
      case MatchListRepository.StatusFilter.Incomplete =>
        Some(statusIn("d.computed_status", MatchListRepository.IncompleteStatuses))
      case MatchListRepository.StatusFilter.OcrRunning =>
        Some(fr"d.computed_status = ${MatchDraftStatus.OcrRunning}")
      case MatchListRepository.StatusFilter.PreConfirm => Some(statusIn(
          "d.computed_status",
          Set(MatchDraftStatus.OcrFailed, MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview),
        ))
      case MatchListRepository.StatusFilter.NeedsReview =>
        Some(fr"d.computed_status = ${MatchDraftStatus.NeedsReview}")
      case MatchListRepository.StatusFilter.Confirmed => Some(fr"FALSE")
    val draftSelect = draftBase ++
      fragments.whereAndOpt(draftConditionsCommon ++ draftStatusCondition.toList)

    val includeMatches = filter.kind match
      case MatchListRepository.KindFilter.Match => true
      case MatchListRepository.KindFilter.MatchDraft => false
      case MatchListRepository.KindFilter.All =>
        filter.status == MatchListRepository.StatusFilter.All ||
        filter.status == MatchListRepository.StatusFilter.Confirmed
    val includeDrafts = filter.kind match
      case MatchListRepository.KindFilter.Match => false
      case MatchListRepository.KindFilter.MatchDraft => true
      case MatchListRepository.KindFilter.All => filter.status !=
          MatchListRepository.StatusFilter.Confirmed

    val unionSelect = (includeMatches, includeDrafts) match
      case (true, true) => Some(confirmedSelect ++ fr"UNION ALL" ++ draftSelect)
      case (true, false) => Some(confirmedSelect)
      case (false, true) => Some(draftSelect)
      case (false, false) => None

    unionSelect match
      case None => List.empty[MatchListItem].pure[F]
      case Some(selectQuery) =>
        val limit = filter.limit.map(v => fr"LIMIT $v").getOrElse(Fragment.empty)
        val ordered = fr"SELECT * FROM (" ++ selectQuery ++ fr""") AS combined
              ORDER BY COALESCE(combined.played_at, combined.updated_at) DESC,
                       combined.updated_at DESC,
                       combined.created_at DESC""" ++ limit
        for
          rows <- ordered.query[Row].to[List].transact(transactor)
          matchIds = rows.flatMap(_._3).distinct
          ranks <- loadRanks(matchIds)
        yield rows.map(row => toItem(row, matchId => ranks.getOrElse(matchId, Nil)))

  private def loadRanks(matchIds: List[MatchId]): F[Map[MatchId, List[MatchListRankEntry]]] =
    if matchIds.isEmpty then Map.empty[MatchId, List[MatchListRankEntry]].pure[F]
    else
      val ids = NonEmptyList.fromListUnsafe(matchIds)
      (fr"""
        SELECT match_id, member_id, rank, play_order
        FROM match_players
        WHERE """ ++ fragments.in(fr"match_id", ids) ++ fr"""
        ORDER BY match_id, play_order
      """).query[(MatchId, MemberId, Int, Int)].to[List].transact(transactor).map { rows =>
        rows.groupBy(_._1).view.mapValues(_.map(row => MatchListRankEntry(row._2, row._3, row._4)))
          .toMap
      }

  private def toItem(row: Row, getRanks: MatchId => List[MatchListRankEntry]): MatchListItem =
    val kind = MatchListItemKind.fromWire(row._1).getOrElse(MatchListItemKind.Match)
    val ranks = row._3.map(getRanks).getOrElse(Nil)
    MatchListItem(
      kind = kind,
      id = row._2,
      matchId = row._3,
      matchDraftId = row._4,
      status = row._5,
      heldEventId = row._6,
      matchNoInEvent = row._7,
      gameTitleId = row._8,
      seasonMasterId = row._9,
      mapMasterId = row._10,
      ownerMemberId = row._11,
      playedAt = row._12,
      createdAt = row._13,
      updatedAt = row._14,
      ranks = ranks,
    )

  private def statusIn(column: String, statuses: Set[MatchDraftStatus]): Fragment =
    val nonEmpty = NonEmptyList.fromListUnsafe(statuses.toList)
    fragments.in(Fragment.const(column), nonEmpty)
