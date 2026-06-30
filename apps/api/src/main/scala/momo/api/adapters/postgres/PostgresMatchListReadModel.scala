package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.matchlist.MatchListProjection
import momo.api.domain.{
  MatchDraftStatus,
  MatchListItem,
  MatchListStatusFilter,
  MatchListSummary,
  PagedResult
}
import momo.api.repositories.{MatchListAlg, MatchListReadModel}

/**
 * Read-model algebra for the match list view.
 *
 * The `list` query is shaped as a UNION ALL over confirmed `matches` and computed-status
 * `match_drafts`, and we need per-row rank chips for confirmed matches. We compose both fetches in
 * a single `ConnectionIO` so the whole list view runs in one transaction (one snapshot, one
 * round-trip group), preventing read skew between the listing and rank decoration.
 */
object PostgresMatchList extends PostgresMatchListSupport:
  val alg: MatchListAlg[ConnectionIO] = new MatchListAlg[ConnectionIO]:
    override def list(filter: MatchListReadModel.Filter): ConnectionIO[PagedResult[MatchListItem]] =
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
        case MatchListStatusFilter.All => None
        case MatchListStatusFilter.Incomplete =>
          Some(statusIn(StatusColumn.DraftComputed, MatchListStatusFilter.incompleteStatuses))
        case MatchListStatusFilter.OcrRunning =>
          Some(fr"d.computed_status = ${MatchDraftStatus.OcrRunning}")
        case MatchListStatusFilter.PreConfirm => Some(statusIn(
            StatusColumn.DraftComputed,
            MatchListProjection.preConfirmStatuses,
          ))
        case MatchListStatusFilter.NeedsReview =>
          Some(fr"d.computed_status = ${MatchDraftStatus.NeedsReview}")
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
        case None => PagedResult(List.empty[MatchListItem], filter.page, 0).pure[ConnectionIO]
        case Some(selectQuery) =>
          val pageLimit = fr"LIMIT ${filter.page.pageSize} OFFSET ${filter.page.offset}"
          val ordered = fr"SELECT * FROM (" ++ selectQuery ++ fr""") AS combined
                """ ++ orderBy(filter.sort) ++ pageLimit
          for
            total <- (fr"SELECT COUNT(*)::int FROM (" ++ selectQuery ++ fr") AS count_source")
              .query[Int].unique
            rows <- ordered.query[Row].to[List]
            matchIds = rows.flatMap(_.matchId).distinct
            ranks <- loadRanks(matchIds)
          yield PagedResult(
            rows.map(row => toItem(row, matchId => ranks.getOrElse(matchId, Nil))),
            filter.page,
            total,
          )

    override def summarize(
        filter: MatchListReadModel.SummaryFilter
    ): ConnectionIO[MatchListSummary] =
      val draftConditionsCommon = List(
        filter.heldEventId.map(v => fr"d.held_event_id = $v"),
        filter.gameTitleId.map(v => fr"d.game_title_id = $v"),
        filter.seasonMasterId.map(v => fr"d.season_master_id = $v"),
        Some(fr"d.persisted_status <> ${MatchDraftStatus.Cancelled}"),
        Some(fr"d.persisted_status <> ${MatchDraftStatus.Confirmed}"),
      ).flatten
      val draftSelect = draftBase ++ fragments.whereAndOpt(draftConditionsCommon)
      val incompleteCondition =
        statusIn(StatusColumn.CombinedStatus, MatchListStatusFilter.incompleteStatuses)
      val preConfirmCondition =
        statusIn(StatusColumn.CombinedStatus, MatchListProjection.preConfirmStatuses)
      val query =
        fr"SELECT COUNT(*) FILTER (WHERE" ++ incompleteCondition ++ fr""")::int AS incomplete_count,
          COUNT(*) FILTER (WHERE combined.status = 'ocr_running')::int AS ocr_running_count,
          COUNT(*) FILTER (WHERE""" ++ preConfirmCondition ++ fr""")::int AS pre_confirm_count,
          COUNT(*) FILTER (WHERE combined.status = 'needs_review')::int AS needs_review_count
        FROM (""" ++ draftSelect ++ fr") AS combined"
      query.query[SummaryRow].unique.map(_.toSummary)
end PostgresMatchList

/** Backwards-compatible class facade. */
final class PostgresMatchListReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchListReadModel[F]:
  private val delegate: MatchListReadModel[F] = MatchListReadModel
    .fromAlg(PostgresMatchList.alg, Database.transactK(transactor))

  export delegate.*
end PostgresMatchListReadModel
