package momo.api.adapters.inmemory

import java.time.temporal.ChronoUnit

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.matchlist.MatchListProjection
import momo.api.domain.{
  MatchDraftStatus,
  MatchListItem,
  MatchListItemKind,
  MatchListKindFilter,
  MatchListRankEntry,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummary
}
import momo.api.repositories.{MatchDraftsRepository, MatchListReadModel, MatchesRepository}

final class InMemoryMatchListReadModel[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends MatchListReadModel[F]:
  override def list(
      filter: MatchListReadModel.Filter
  ): F[MatchListReadModel.CursorPage[MatchListItem]] = listItems(
    heldEventId = filter.heldEventId,
    gameTitleId = filter.gameTitleId,
    seasonMasterId = filter.seasonMasterId,
    statusFilter = filter.status,
    kind = filter.kind,
  ).map { combined =>
    val positioned = combined.map(item => (item, position(item))).sortWith {
      case ((_, left), (_, right)) => comparePositions(left, right, filter.sort) < 0
    }
    val totalItems = filter.page.cursor.fold(positioned.size)(_.totalItems)
    val page = filter.page.cursor.fold(1)(_.page)
    val totalPages = pageCount(totalItems, filter.page.pageSize)
    val targetSize = pageItemCount(totalItems, page, filter.page.pageSize, totalPages)
    val selected = filter.page.cursor match
      case None => positioned.take(targetSize)
      case Some(cursor) => cursor.direction match
          case MatchListReadModel.CursorDirection.After => positioned
              .filter { case (_, candidate) =>
                cursor.position.exists(boundary =>
                  comparePositions(candidate, boundary, filter.sort) > 0
                )
              }
              .take(targetSize)
          case MatchListReadModel.CursorDirection.Before => cursor.position match
              case Some(boundary) => positioned
                  .filter { case (_, candidate) =>
                    comparePositions(candidate, boundary, filter.sort) < 0
                  }
                  .takeRight(targetSize)
              case None => positioned.takeRight(targetSize)
    MatchListReadModel.CursorPage(
      items = selected.map(_._1),
      pageSize = filter.page.pageSize,
      totalItems = totalItems,
      page = page,
      previousCursor = selected.headOption.filter(_ => page > 1).map { case (_, position) =>
        MatchListReadModel.Cursor(
          MatchListReadModel.CursorDirection.Before,
          page - 1,
          totalItems,
          Some(position),
        )
      },
      nextCursor = selected.lastOption.filter(_ => page < totalPages).map { case (_, position) =>
        MatchListReadModel.Cursor(
          MatchListReadModel.CursorDirection.After,
          page + 1,
          totalItems,
          Some(position),
        )
      },
      lastCursor = Option.when(totalPages > 1)(MatchListReadModel.Cursor(
        MatchListReadModel.CursorDirection.Before,
        totalPages,
        totalItems,
        None,
      )),
    )
  }

  override def summarize(filter: MatchListReadModel.SummaryFilter): F[MatchListSummary] = listItems(
    heldEventId = filter.heldEventId,
    gameTitleId = filter.gameTitleId,
    seasonMasterId = filter.seasonMasterId,
    statusFilter = MatchListStatusFilter.All,
    kind = MatchListKindFilter.MatchDraft,
  ).map(items =>
    MatchListProjection.summarizeDraftStatuses(items.flatMap(item =>
      MatchDraftStatus.fromWire(item.status)
    ))
  )

  override def listDraftsByHeldEvent(heldEventId: HeldEventId): F[List[MatchListItem]] = listItems(
    heldEventId = Some(heldEventId),
    gameTitleId = None,
    seasonMasterId = None,
    statusFilter = MatchListStatusFilter.All,
    kind = MatchListKindFilter.MatchDraft,
  ).map(items => MatchListProjection.sortItems(items, MatchListSort.MatchNoAsc))

  private def listItems(
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
      statusFilter: MatchListStatusFilter,
      kind: MatchListKindFilter,
  ): F[List[MatchListItem]] =
    for
      confirmed <- matches.list(MatchesRepository.ListFilter(
        heldEventId = heldEventId,
        gameTitleId = gameTitleId,
        seasonMasterId = seasonMasterId,
        limit = None,
      ))
      drafts <- matchDrafts.list(MatchDraftsRepository.ListFilter(
        heldEventId = heldEventId,
        gameTitleId = gameTitleId,
        seasonMasterId = seasonMasterId,
        limit = None,
      ))
      projectedDrafts = drafts.filterNot(d =>
        d.status == MatchDraftStatus.Cancelled || d.status == MatchDraftStatus.Confirmed
      ).map(draft => (draft, draft.status))
    yield
      val confirmedItems = confirmed.map { record =>
        MatchListItem(
          kind = MatchListItemKind.Match,
          id = record.id.value,
          matchId = Some(record.id),
          matchDraftId = None,
          status = MatchDraftStatus.Confirmed.wire,
          heldEventId = Some(record.heldEventId),
          matchNoInEvent = Some(record.matchNoInEvent),
          gameTitleId = Some(record.gameTitleId),
          seasonMasterId = Some(record.seasonMasterId),
          mapMasterId = Some(record.mapMasterId),
          ownerMemberId = Some(record.ownerMemberId),
          playedAt = Some(record.playedAt),
          createdAt = record.createdAt,
          updatedAt = record.createdAt,
          ranks = record.players.byPlayOrder
            .map(p => MatchListRankEntry(p.memberId, p.rank, p.playOrder)),
          hasNote = Some(record.note.body.isDefined),
        )
      }

      val draftItems = projectedDrafts.filter { case (_, status) =>
        MatchListProjection.statusMatchesFilter(status, statusFilter)
      }.map { case (draft, status) =>
        MatchListItem(
          kind = MatchListItemKind.MatchDraft,
          id = draft.id.value,
          matchId = None,
          matchDraftId = Some(draft.id),
          status = status.wire,
          heldEventId = draft.heldEventId,
          matchNoInEvent = draft.matchNoInEvent,
          gameTitleId = draft.gameTitleId,
          seasonMasterId = draft.seasonMasterId,
          mapMasterId = draft.mapMasterId,
          ownerMemberId = draft.ownerMemberId,
          playedAt = draft.playedAt,
          createdAt = draft.createdAt,
          updatedAt = draft.updatedAt,
          ranks = Nil,
          hasNote = None,
        )
      }

      val includeMatches = MatchListProjection.includeMatches(kind, statusFilter)
      val includeDrafts = MatchListProjection.includeDrafts(kind, statusFilter)
      (includeMatches, includeDrafts) match
        case (true, true) => confirmedItems ++ draftItems
        case (true, false) => confirmedItems
        case (false, true) => draftItems
        case (false, false) => Nil

  private def position(item: MatchListItem): MatchListReadModel.CursorPosition =
    val statusPriority = MatchDraftStatus.fromWire(item.status)
      .map(MatchListProjection.displayPriority).getOrElse(3)
    MatchListReadModel.CursorPosition(
      statusPriority = statusPriority,
      updatedAt = item.updatedAt.truncatedTo(ChronoUnit.MICROS),
      heldAt = item.playedAt.getOrElse(item.updatedAt).truncatedTo(ChronoUnit.MICROS),
      matchNoIsNull = item.matchNoInEvent.isEmpty,
      matchNoSort = item.matchNoInEvent.map(_.value).getOrElse(Int.MaxValue),
      kind = item.kind.wire,
      id = item.id,
    )

  private def comparePositions(
      left: MatchListReadModel.CursorPosition,
      right: MatchListReadModel.CursorPosition,
      sort: MatchListSort,
  ): Int =
    def firstNonZero(values: Int*): Int = values.find(_ != 0).getOrElse(0)
    def asc[A](left: A, right: A)(using ordering: Ordering[A]): Int = ordering.compare(left, right)
    def desc[A](left: A, right: A)(using ordering: Ordering[A]): Int = -asc(left, right)
    given Ordering[java.time.Instant] = Ordering.fromLessThan(_.isBefore(_))
    val tieBreaker = List(asc(left.kind, right.kind), asc(left.id, right.id))
    sort match
      case MatchListSort.StatusPriority => firstNonZero(
          asc(left.statusPriority, right.statusPriority),
          desc(left.updatedAt, right.updatedAt),
          tieBreaker.head,
          tieBreaker(1),
        )
      case MatchListSort.UpdatedDesc =>
        firstNonZero(desc(left.updatedAt, right.updatedAt), tieBreaker.head, tieBreaker(1))
      case MatchListSort.HeldDesc => firstNonZero(
          desc(left.heldAt, right.heldAt),
          desc(left.updatedAt, right.updatedAt),
          tieBreaker.head,
          tieBreaker(1),
        )
      case MatchListSort.HeldAsc => firstNonZero(
          asc(left.heldAt, right.heldAt),
          desc(left.updatedAt, right.updatedAt),
          tieBreaker.head,
          tieBreaker(1),
        )
      case MatchListSort.MatchNoAsc => firstNonZero(
          asc(left.matchNoIsNull, right.matchNoIsNull),
          asc(left.matchNoSort, right.matchNoSort),
          desc(left.updatedAt, right.updatedAt),
          tieBreaker.head,
          tieBreaker(1),
        )

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
