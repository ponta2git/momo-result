package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.matchlist.MatchListProjection
import momo.api.domain.{
  MatchDraftStatus,
  MatchLabels,
  MatchListItem,
  MatchListStatusFilter,
  MatchListSummary
}
import momo.api.repositories.{MatchListAlg, MatchListReadModel}

/**
 * Read-model algebra for the match list view.
 *
 * The `list` query is shaped as a UNION ALL over confirmed `matches` and persisted-status
 * `match_drafts`, and we need per-row rank chips for confirmed matches. We compose both fetches in
 * a single `ConnectionIO` so the whole list view runs in one transaction (one snapshot, one
 * round-trip group), preventing read skew between the listing and rank decoration.
 */
object PostgresMatchList extends PostgresMatchListSupport:
  val alg: MatchListAlg[ConnectionIO] = new MatchListAlg[ConnectionIO]:
    override def list(
        filter: MatchListReadModel.Filter
    ): ConnectionIO[MatchListReadModel.CursorPage[MatchListItem]] =
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
        Some(fr"d.status <> ${MatchDraftStatus.Cancelled}"),
        Some(fr"d.status <> ${MatchDraftStatus.Confirmed}"),
      ).flatten
      val draftStatusCondition = filter.status match
        case MatchListStatusFilter.All => None
        case MatchListStatusFilter.Incomplete =>
          Some(statusIn(MatchListStatusFilter.incompleteStatuses))
        case MatchListStatusFilter.OcrRunning =>
          Some(fr"d.status = ${MatchDraftStatus.OcrRunning}")
        case MatchListStatusFilter.PreConfirm => Some(statusIn(
            MatchListProjection.preConfirmStatuses,
          ))
        case MatchListStatusFilter.NeedsReview =>
          Some(fr"d.status = ${MatchDraftStatus.NeedsReview}")
        case MatchListStatusFilter.Confirmed => Some(fr"FALSE")
      val draftSelect = draftBase ++
        fragments.whereAndOpt(draftConditionsCommon ++ draftStatusCondition.toList)

      val includeMatches = MatchListProjection.includeMatches(filter.kind, filter.status)
      val includeDrafts = MatchListProjection.includeDrafts(filter.kind, filter.status)

      val unionSelect = (includeMatches, includeDrafts) match
        case (true, true) => Some(confirmedSelect ++ fr"UNION ALL" ++ draftSelect)
        case (true, false) => Some(confirmedSelect)
        case (false, true) => Some(draftSelect)
        case (false, false) => None

      unionSelect match
        case None => MatchListReadModel.CursorPage(
            items = List.empty[MatchListItem],
            pageSize = filter.page.pageSize,
            totalItems = 0,
            page = 1,
            previousCursor = None,
            nextCursor = None,
            lastCursor = None,
          ).pure[ConnectionIO]
        case Some(selectQuery) =>
          val countQuery =
            fr"SELECT COUNT(*)::int FROM (" ++ selectQuery ++ fr") AS count_source"
          for
            // COUNT/page/rank decoration are separate bounded statements. Pin them to one MVCC
            // snapshot so first-page metadata and rows cannot skew under concurrent writes.
            _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ".update.run.void
            total <- filter.page.cursor.fold(countQuery.query[Int].unique)(cursor =>
              cursor.totalItems.pure[ConnectionIO]
            )
            page = filter.page.cursor.fold(1)(_.page)
            totalPages = pageCount(total, filter.page.pageSize)
            targetSize = pageItemCount(total, page, filter.page.pageSize, totalPages)
            direction = filter.page.cursor.fold(MatchListReadModel.CursorDirection.After)(
              _.direction
            )
            boundary = filter.page.cursor.flatMap(cursorBoundary(filter.sort, _))
            ordered = fr"SELECT sortable.* FROM (" ++ sortable(selectQuery) ++
              fr") AS sortable" ++ fragments.whereAndOpt(boundary.toList) ++
              cursorOrderBy(filter.sort, direction) ++ fr"LIMIT $targetSize"
            fetched <-
              if targetSize == 0 then List.empty[CursorRow].pure[ConnectionIO]
              else
                (withLabels(
                  ordered
                ) ++ cursorOrderBy(filter.sort, direction)).query[CursorRow].to[List]
            pageRows = direction match
              case MatchListReadModel.CursorDirection.After => fetched
              case MatchListReadModel.CursorDirection.Before => fetched.reverse
            rows = pageRows.map(_.row)
            matchIds = rows.flatMap(_.matchId).distinct
            ranks <- loadRanks(matchIds)
          yield MatchListReadModel.CursorPage(
            items = pageRows.map(cursor =>
              toItem(cursor.row, cursor.labels, matchId => ranks.getOrElse(matchId, Nil))
            ),
            pageSize = filter.page.pageSize,
            totalItems = total,
            page = page,
            previousCursor = pageRows.headOption.filter(_ => page > 1).map(row =>
              MatchListReadModel.Cursor(
                MatchListReadModel.CursorDirection.Before,
                page - 1,
                total,
                Some(row.position),
              )
            ),
            nextCursor = pageRows.lastOption.filter(_ => page < totalPages).map(row =>
              MatchListReadModel.Cursor(
                MatchListReadModel.CursorDirection.After,
                page + 1,
                total,
                Some(row.position),
              )
            ),
            lastCursor = Option.when(totalPages > 1)(MatchListReadModel.Cursor(
              MatchListReadModel.CursorDirection.Before,
              totalPages,
              total,
              None,
            )),
          )

    override def listDraftsByHeldEvent(heldEventId: momo.api.domain.ids.HeldEventId)
        : ConnectionIO[List[MatchListItem]] =
      val selected = draftBase ++ fragments.whereAnd(
        fr"d.held_event_id = $heldEventId",
        fr"d.status <> ${MatchDraftStatus.Cancelled}",
        fr"d.status <> ${MatchDraftStatus.Confirmed}",
      )
      (withLabels(selected) ++ fr"""
        ORDER BY sortable.match_no_in_event ASC NULLS LAST, sortable.updated_at DESC,
                 sortable.kind ASC, sortable.id ASC
      """).query[(Row, MatchLabels)].to[List].map(_.map { case (row, labels) =>
        toItem(row, labels, _ => Nil)
      })

    override def summarize(
        filter: MatchListReadModel.SummaryFilter
    ): ConnectionIO[MatchListSummary] =
      val draftConditionsCommon = List(
        filter.heldEventId.map(v => fr"d.held_event_id = $v"),
        filter.gameTitleId.map(v => fr"d.game_title_id = $v"),
        filter.seasonMasterId.map(v => fr"d.season_master_id = $v"),
        Some(fr"d.status <> ${MatchDraftStatus.Cancelled}"),
        Some(fr"d.status <> ${MatchDraftStatus.Confirmed}"),
      ).flatten
      val incompleteCondition =
        statusIn(MatchListStatusFilter.incompleteStatuses)
      val preConfirmCondition =
        statusIn(MatchListProjection.preConfirmStatuses)
      val query =
        fr"SELECT COUNT(*) FILTER (WHERE" ++ incompleteCondition ++ fr""")::int AS incomplete_count,
          COUNT(*) FILTER (WHERE d.status = 'ocr_running')::int AS ocr_running_count,
          COUNT(*) FILTER (WHERE""" ++ preConfirmCondition ++ fr""")::int AS pre_confirm_count,
          COUNT(*) FILTER (WHERE d.status = 'needs_review')::int AS needs_review_count
        FROM match_drafts d""" ++ fragments.whereAndOpt(draftConditionsCommon)
      query.query[SummaryRow].unique.map(_.toSummary)

    private def pageCount(totalItems: Int, pageSize: Int): Int =
      if totalItems <= 0 then 0
      else ((totalItems.toLong + pageSize.toLong - 1L) / pageSize.toLong).toInt

    private def pageItemCount(
        totalItems: Int,
        page: Int,
        pageSize: Int,
        totalPages: Int,
    ): Int =
      if totalItems <= 0 then 0
      else if page == totalPages then totalItems - ((page - 1) * pageSize)
      else pageSize
end PostgresMatchList

final class PostgresMatchListReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchListReadModel[F]:
  private val delegate: MatchListReadModel[F] = MatchListReadModel
    .fromAlg(PostgresMatchList.alg, transactor.trans)

  export delegate.*
end PostgresMatchListReadModel
