package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, HeldEventListItem, HeldEventListPage, HeldEventScopeSummary, MatchDraftStatus, PageRequest, PagedResult}
import momo.api.repositories.HeldEventListReadModel

object PostgresHeldEventList:
  private final case class ScopeStats(
      heldEventId: HeldEventId,
      confirmed: Boolean,
      count: Int,
      maxMatchNo: Int,
      scope: HeldEventScopeSummary,
  )

  private def matchingEvents(query: Option[String]): Fragment =
    query.map(_.trim).filter(_.nonEmpty).fold(Fragment.empty) { value =>
      val pattern = s"%$value%"
      fr"WHERE he.id ILIKE $pattern"
    }

  def list(query: Option[String], page: PageRequest): ConnectionIO[HeldEventListPage] =
    val where = matchingEvents(query)
    val matchFilter = query.map(_.trim).filter(_.nonEmpty).fold(Fragment.empty)(_ =>
      fr"JOIN held_events he ON he.id = m.held_event_id" ++ where
    )
    val totals = fr"SELECT COUNT(*)::int, (SELECT COUNT(*)::int FROM matches m" ++
      matchFilter ++ fr") FROM held_events he" ++ where
    for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      counts <- totals.query[(Int, Int)].unique
      events <- (fr"SELECT he.id, he.start_at FROM held_events he" ++ where ++
        fr"ORDER BY he.start_at DESC, he.id DESC LIMIT ${page.pageSize} OFFSET ${page.offset}")
        .query[HeldEvent].to[List]
      stats <- scopeStats(events.map(_.id))
      byEvent = stats.groupMap(_.heldEventId)(identity)
      items = events.map { event =>
        val rows = byEvent.getOrElse(event.id, Nil)
        HeldEventListItem(
          event,
          rows.filter(_.confirmed).map(_.count).sum,
          rows.filterNot(_.confirmed).map(_.count).sum,
          rows.map(_.maxMatchNo).maxOption.getOrElse(0) + 1,
          HeldEventScopeSummary.ordered(rows.map(_.scope)),
        )
      }
    yield HeldEventListPage(PagedResult(items, page, counts._1), counts._2)

  private def scopeStats(ids: List[HeldEventId]): ConnectionIO[List[ScopeStats]] =
    if ids.isEmpty then List.empty[ScopeStats].pure[ConnectionIO]
    else
      val values = ids.map(_.value).toArray
      sql"""
        SELECT scoped.*, gt.name, season.name
        FROM (
          SELECT held_event_id, true AS confirmed, COUNT(*)::int AS count,
                 MAX(match_no_in_event)::int AS max_no, game_title_id, season_master_id
          FROM matches WHERE held_event_id = ANY($values)
          GROUP BY held_event_id, game_title_id, season_master_id
          UNION ALL
          SELECT held_event_id, false AS confirmed, COUNT(*)::int AS count,
                 COALESCE(MAX(match_no_in_event), 0)::int AS max_no, game_title_id, season_master_id
          FROM match_drafts WHERE held_event_id = ANY($values)
            AND status <> ${MatchDraftStatus.Cancelled} AND status <> ${MatchDraftStatus.Confirmed}
          GROUP BY held_event_id, game_title_id, season_master_id
        ) scoped
        LEFT JOIN game_titles gt ON gt.id = scoped.game_title_id
        LEFT JOIN season_masters season ON season.id = scoped.season_master_id
      """.query[ScopeStats].to[List]

final class PostgresHeldEventListReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends HeldEventListReadModel[F]:
  override def list(query: Option[String], page: PageRequest): F[HeldEventListPage] =
    PostgresHeldEventList.list(query, page).transact(transactor)
