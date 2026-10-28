package momo.api.adapters.postgres

import cats.data.NonEmptyList
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.fragments

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{HeldEventId, MatchId, MemberId}
import momo.api.domain.{
  HeldEvent,
  HeldEventListItem,
  HeldEventListMetric,
  HeldEventListMetricCriterion,
  HeldEventListPage,
  HeldEventListSearchCriteria,
  HeldEventListSort,
  HeldEventNoteMatch,
  HeldEventPlayerResult,
  HeldEventScopeSummary,
  MatchDraftStatus,
  MatchListRecordRange,
  MatchNoteBody,
  PageRequest,
  PagedResult
}
import momo.api.repositories.HeldEventListReadModel

object PostgresHeldEventList:
  private final case class PageTotals(
      totalItems: Int,
      totalMatchCount: Int,
      latestHeldEventId: Option[HeldEventId],
  )

  private final case class ScopeStats(
      heldEventId: HeldEventId,
      confirmed: Boolean,
      count: Int,
      maxMatchNo: Int,
      scope: HeldEventScopeSummary,
  )

  private final case class PlayerRow(
      heldEventId: HeldEventId,
      memberId: MemberId,
      averageRank: BigDecimal,
      first: Int,
      second: Int,
      third: Int,
      fourth: Int,
  ):
    def toResult: HeldEventPlayerResult =
      HeldEventPlayerResult(memberId, averageRank, List(first, second, third, fourth))

  private final case class NoteRow(
      heldEventId: HeldEventId,
      matchId: MatchId,
      matchNoInEvent: Int,
      noteBody: String,
      otherMatchCount: Int,
  ):
    def toNoteMatch: HeldEventNoteMatch =
      HeldEventNoteMatch(matchId, matchNoInEvent, noteBody, otherMatchCount)

  private val confirmedOfEvent = fr"SELECT 1 FROM matches m WHERE m.held_event_id = he.id"
  private val averageRank =
    fr"ROUND(AVG(mp.rank)::numeric, ${HeldEventListMetric.AverageRankScale})"

  /** Search predicates over `held_events he`; match criteria only see confirmed matches. */
  private def searchConditions(search: HeldEventListSearchCriteria)(using
      ids: PostgresIdentities): List[Fragment] =
    val scope = List(
      search.gameTitleId
        .map(v => fr"m.game_title_id = ${ids.lookup(Entity.GameTitles, v.value)}"),
      search.seasonMasterId
        .map(v => fr"m.season_master_id = ${ids.lookup(Entity.SeasonMasters, v.value)}"),
      search.mapMasterId.map(v => fr"m.map_master_id = ${ids.lookup(Entity.MapMasters, v.value)}"),
    ).flatten
    List(
      NonEmptyList.fromList(scope)
        .map(conditions =>
          fr"EXISTS (" ++ confirmedOfEvent ++ fr"AND" ++ fragments.and(conditions) ++ fr")"
        ),
      search.heldFromInclusive.map(from => fr"he.start_at >= $from"),
      search.heldToExclusive.map(to => fr"he.start_at < $to"),
      search.minMatchCount
        .map(n => fr"(SELECT COUNT(*) FROM matches m WHERE m.held_event_id = he.id) >= $n"),
      // strpos keeps the user's text literal: no LIKE wildcard or escape interpretation.
      search.noteQuery.map(q =>
        fr"EXISTS (" ++ confirmedOfEvent ++ fr"AND strpos(lower(m.note_body), lower($q)) > 0)"
      ),
      search.metric.map(metricCondition),
    ).flatten

  private def metricCondition(criterion: HeldEventListMetricCriterion)(using
      ids: PostgresIdentities): Fragment =
    val aggregate = criterion.metric.countedRank match
      case None => averageRank
      case Some(rank) => fr"COUNT(*) FILTER (WHERE mp.rank = $rank)"
    val comparison = criterion.range match
      case MatchListRecordRange.Gte => fr" >= "
      case MatchListRecordRange.Lte => fr" <= "
    val member = criterion.memberId
      .map(v => fr"AND mp.member_id = ${ids.lookup(Entity.Members, v.value)}")
    fr"""EXISTS (SELECT 1 FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE m.held_event_id = he.id""" ++ member.getOrElse(Fragment.empty) ++
      fr"GROUP BY mp.member_id HAVING" ++ aggregate ++ comparison ++ fr"${criterion.value})"

  private def ordering(startAt: Fragment, id: Fragment, sort: HeldEventListSort): Fragment =
    val direction = sort match
      case HeldEventListSort.HeldDesc => fr"DESC"
      case HeldEventListSort.HeldAsc => fr"ASC"
    fr"ORDER BY" ++ startAt ++ direction ++ fr"," ++
      id ++ fr"""COLLATE "C"""" ++ direction

  def list(search: HeldEventListSearchCriteria, sort: HeldEventListSort, page: PageRequest)(using
      identities: PostgresIdentities): ConnectionIO[HeldEventListPage] =
    list(search, sort, page, PostgresPublicIds.Legacy)

  def list(
      search: HeldEventListSearchCriteria,
      sort: HeldEventListSort,
      page: PageRequest,
      publicIds: PostgresPublicIds,
  )(using ids: PostgresIdentities): ConnectionIO[HeldEventListPage] =
    val where = fragments.whereAndOpt(searchConditions(search))
    // The latest event ignores the search so the Web can mark the true newest row on any page.
    val latest = fr"(SELECT" ++ ids.wireId("latest") ++ fr"FROM held_events latest" ++
      ordering(fr"latest.start_at", ids.wireId("latest"), HeldEventListSort.HeldDesc) ++
      fr"LIMIT 1)"
    val totals =
      fr"""SELECT (SELECT COUNT(*)::int FROM filtered) AS total_items,
        (SELECT COUNT(*)::int FROM matches m WHERE m.held_event_id IN (SELECT id FROM filtered))
          AS total_match_count,
      """ ++ latest ++ fr"AS latest_held_event_id"
    val selected =
      fr"SELECT ${ids.wireId("he")} AS id, he.start_at," ++
        publicIds.column(fr"he.public_id") ++ fr"""AS public_id
        FROM held_events he JOIN filtered ON filtered.id = he.id""" ++
        ordering(fr"he.start_at", ids.wireId("he"), sort) ++
        fr"LIMIT ${page.pageSize} OFFSET ${page.offset}"
    // Reuse expensive note/metric predicates for both totals and pagination. The left join
    // retains totals even when no event matches or the requested page is past the last one.
    val selection = fr"WITH filtered AS MATERIALIZED (SELECT he.id FROM held_events he" ++ where ++
      fr""") SELECT totals.total_items, totals.total_match_count, totals.latest_held_event_id,
        selected.id, selected.start_at, selected.public_id
        FROM (""" ++ totals ++ fr") totals LEFT JOIN (" ++ selected ++ fr") selected ON TRUE" ++
      ordering(fr"selected.start_at", fr"selected.id", sort)
    for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
      rows <- selection.query[(PageTotals, Option[HeldEvent])].nel
      counts = rows.head._1
      events = rows.toList.flatMap(_._2)
      eventIds = events.map(_.id)
      stats <- scopeStats(eventIds)
      players <- playerResults(eventIds)
      notes <-
        search.noteQuery.fold(List.empty[NoteRow].pure[ConnectionIO])(noteMatches(eventIds, _))
      byEvent = stats.groupMap(_.heldEventId)(identity)
      playersByEvent = players.groupMap(_.heldEventId)(_.toResult)
      noteByEvent = notes.map(row => row.heldEventId -> row.toNoteMatch).toMap
      items = events.map { event =>
        val rows = byEvent.getOrElse(event.id, Nil)
        HeldEventListItem(
          event,
          rows.filter(_.confirmed).map(_.count).sum,
          rows.filterNot(_.confirmed).map(_.count).sum,
          rows.map(_.maxMatchNo).maxOption.getOrElse(0) + 1,
          HeldEventScopeSummary.ordered(rows.map(_.scope)),
          playersByEvent.getOrElse(event.id, Nil).sortBy(_.memberId.value),
          noteByEvent.get(event.id),
        )
      }
    yield HeldEventListPage(
      PagedResult(items, page, counts.totalItems),
      counts.totalMatchCount,
      counts.latestHeldEventId,
    )

  private def scopeStats(eventIds: List[HeldEventId])(using
      ids: PostgresIdentities): ConnectionIO[List[ScopeStats]] =
    if eventIds.isEmpty then List.empty[ScopeStats].pure[ConnectionIO]
    else
      val values = ids.lookupArray(Entity.HeldEvents, eventIds.map(_.value))
      val nameLimit = PostgresReadBudget.NameCodePoints
      PostgresReadBudget.guardedRows[ScopeStats](
        sql"""
        SELECT COALESCE(char_length(gt.name) <= $nameLimit, true)
                 AND COALESCE(char_length(season.name) <= $nameLimit, true),
               ${ids.wireReference(Entity.HeldEvents, fr"scoped.held_event_id")},
               scoped.confirmed, scoped.count, scoped.max_no,
               ${ids.wireReference(Entity.GameTitles, fr"scoped.game_title_id")},
               ${ids.wireReference(Entity.SeasonMasters, fr"scoped.season_master_id")},
               LEFT(gt.name, $nameLimit), LEFT(season.name, $nameLimit)
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
      """,
        PostgresReadBudget.ScopeRows,
        "Held-event scopes"
      )

  /** One row per (event, member) over the page's confirmed matches. */
  private def playerResults(eventIds: List[HeldEventId])(using
      ids: PostgresIdentities): ConnectionIO[List[PlayerRow]] =
    if eventIds.isEmpty then List.empty[PlayerRow].pure[ConnectionIO]
    else
      val values = ids.lookupArray(Entity.HeldEvents, eventIds.map(_.value))
      PostgresReadBudget.rows[PlayerRow](
        fr"SELECT" ++ ids.wireReference(Entity.HeldEvents, fr"m.held_event_id") ++ fr"," ++
          ids.wireReference(Entity.Members, fr"mp.member_id") ++ fr"," ++ averageRank ++
          fr""",
          COUNT(*) FILTER (WHERE mp.rank = 1)::int, COUNT(*) FILTER (WHERE mp.rank = 2)::int,
          COUNT(*) FILTER (WHERE mp.rank = 3)::int, COUNT(*) FILTER (WHERE mp.rank = 4)::int
        FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE m.held_event_id = ANY($values)
        GROUP BY m.held_event_id, mp.member_id""",
        PostgresReadBudget.ScopeRows,
        "Held-event player results",
      )

  /** The lowest-numbered matching confirmed match per page event, with the other hit count. */
  private def noteMatches(eventIds: List[HeldEventId], query: String)(using
      ids: PostgresIdentities): ConnectionIO[List[NoteRow]] =
    if eventIds.isEmpty then List.empty[NoteRow].pure[ConnectionIO]
    else
      val values = ids.lookupArray(Entity.HeldEvents, eventIds.map(_.value))
      val noteLimit = MatchNoteBody.MaximumCodePoints
      PostgresReadBudget.guardedRows[NoteRow](
        fr"SELECT char_length(hit.note_body) <= $noteLimit," ++
          ids.wireReference(Entity.HeldEvents, fr"hit.held_event_id") ++ fr"," ++
          ids.wireReference(Entity.Matches, fr"hit.id") ++ fr""",
          hit.match_no_in_event, LEFT(hit.note_body, $noteLimit), hit.others
        FROM (
          SELECT m.held_event_id, m.id, m.match_no_in_event, m.note_body,
                 ROW_NUMBER() OVER (
                   PARTITION BY m.held_event_id ORDER BY m.match_no_in_event, m.id
                 ) AS position,
                 (COUNT(*) OVER (PARTITION BY m.held_event_id) - 1)::int AS others
          FROM matches m
          WHERE m.held_event_id = ANY($values) AND strpos(lower(m.note_body), lower($query)) > 0
        ) hit
        WHERE hit.position = 1""",
        PostgresReadBudget.ScopeRows,
        "Held-event note matches",
      )

final class PostgresHeldEventListReadModel[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    publicIds: PostgresPublicIds = PostgresPublicIds.Legacy,
    identities: PostgresIdentities = PostgresIdentities.Legacy,
) extends HeldEventListReadModel[F]:
  private given PostgresIdentities = identities
  override def list(
      search: HeldEventListSearchCriteria,
      sort: HeldEventListSort,
      page: PageRequest,
  ): F[HeldEventListPage] = PostgresHeldEventList.list(search, sort, page, publicIds)
    .transact(transactor)
