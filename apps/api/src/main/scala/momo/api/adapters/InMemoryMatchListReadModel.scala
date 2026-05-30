package momo.api.adapters

import cats.Monad
import cats.syntax.all.*
import io.circe.parser.parse

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{
  MatchDraft, MatchDraftOcrSlot, MatchDraftOcrStatus, MatchDraftStatus, MatchListItem,
  MatchListItemKind, MatchListKindFilter, MatchListRankEntry, MatchListSort, MatchListStatusFilter,
  MatchListSummary, OcrDraft, OcrJobStatus, PagedResult,
}
import momo.api.repositories.{
  MatchDraftsRepository, MatchListReadModel, MatchesRepository, OcrDraftsRepository,
  OcrJobsRepository,
}

final class InMemoryMatchListReadModel[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    ocrJobs: Option[OcrJobsRepository[F]] = None,
    ocrDrafts: Option[OcrDraftsRepository[F]] = None,
) extends MatchListReadModel[F]:
  override def list(filter: MatchListReadModel.Filter): F[PagedResult[MatchListItem]] = listItems(
    heldEventId = filter.heldEventId,
    gameTitleId = filter.gameTitleId,
    seasonMasterId = filter.seasonMasterId,
    statusFilter = filter.status,
    kind = filter.kind,
  ).map { combined =>
    val ordered = sortItems(combined, filter.sort)
    val offset = math.min(filter.page.offset, Int.MaxValue.toLong).toInt
    val pageItems = ordered.slice(offset, offset + filter.page.pageSize)
    PagedResult(pageItems, filter.page, ordered.size)
  }

  override def summarize(filter: MatchListReadModel.SummaryFilter): F[MatchListSummary] = listItems(
    heldEventId = filter.heldEventId,
    gameTitleId = filter.gameTitleId,
    seasonMasterId = filter.seasonMasterId,
    statusFilter = MatchListStatusFilter.All,
    kind = MatchListKindFilter.MatchDraft,
  ).map(items =>
    items.foldLeft(MatchListSummary(0, 0, 0, 0)) { (summary, item) =>
      val status = MatchDraftStatus.fromWire(item.status)
      MatchListSummary(
        incompleteCount = summary.incompleteCount +
          status.filter(MatchListStatusFilter.incompleteStatuses.contains).fold(0)(_ => 1),
        ocrRunningCount = summary.ocrRunningCount + status.filter(_ == MatchDraftStatus.OcrRunning)
          .fold(0)(_ => 1),
        preConfirmCount = summary.preConfirmCount + status.filter(s =>
          Set(MatchDraftStatus.OcrFailed, MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview)
            .contains(s)
        ).fold(0)(_ => 1),
        needsReviewCount = summary.needsReviewCount +
          status.filter(_ == MatchDraftStatus.NeedsReview).fold(0)(_ => 1),
      )
    }
  )

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
      projectedDrafts <- drafts.filterNot(d =>
        d.status == MatchDraftStatus.Cancelled || d.status == MatchDraftStatus.Confirmed
      ).traverse(draft => projectedStatus(draft).map(status => (draft, status)))
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
        )
      }

      val draftItems = projectedDrafts.filter { case (_, status) =>
        draftMatchesStatus(status, statusFilter)
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
        )
      }

      val includeMatches = kind match
        case MatchListKindFilter.Match => true
        case MatchListKindFilter.MatchDraft => false
        case MatchListKindFilter.All => statusFilter == MatchListStatusFilter.All ||
          statusFilter == MatchListStatusFilter.Confirmed
      val includeDrafts = kind match
        case MatchListKindFilter.Match => false
        case MatchListKindFilter.MatchDraft => true
        case MatchListKindFilter.All => statusFilter != MatchListStatusFilter.Confirmed
      (includeMatches, includeDrafts) match
        case (true, true) => confirmedItems ++ draftItems
        case (true, false) => confirmedItems
        case (false, true) => draftItems
        case (false, false) => Nil

  private def sortItems(items: List[MatchListItem], sort: MatchListSort): List[MatchListItem] =
    def statusPriority(item: MatchListItem): Int = MatchDraftStatus.fromWire(item.status) match
      case Some(MatchDraftStatus.OcrRunning) => 0
      case Some(MatchDraftStatus.NeedsReview) => 1
      case Some(MatchDraftStatus.DraftReady) => 2
      case Some(MatchDraftStatus.OcrFailed) => 4
      case Some(MatchDraftStatus.Confirmed) => 5
      case _ => 3
    def heldAt(item: MatchListItem): Long = item.playedAt.getOrElse(item.updatedAt).toEpochMilli

    val ordered = sort match
      case MatchListSort.StatusPriority => items
          .sortBy(i => (statusPriority(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.UpdatedDesc => items
          .sortBy(i => (-i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.HeldDesc => items
          .sortBy(i => (-heldAt(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.HeldAsc => items
          .sortBy(i => (heldAt(i), -i.updatedAt.toEpochMilli, i.kind.wire, i.id))
      case MatchListSort.MatchNoAsc => items.sortBy(i =>
          (
            i.matchNoInEvent.map(_.value).getOrElse(Int.MaxValue),
            -i.updatedAt.toEpochMilli,
            i.kind.wire,
            i.id,
          )
        )
    ordered

  private def projectedStatus(draft: MatchDraft): F[MatchDraftStatus] =
    val draftIds = draft.ocrDraftIds

    (ocrJobs, ocrDrafts) match
      case (Some(jobs), Some(drafts))
          if draft.status == MatchDraftStatus.OcrRunning && draftIds.nonEmpty =>
        draftIds.traverse { draftId =>
          drafts.find(draftId).flatMap {
            case None => (Option.empty[OcrJobStatus], false).pure[F]
            case Some(ocrDraft) => jobs.find(ocrDraft.jobId)
                .map(job => (job.map(_.status), hasWarnings(ocrDraft)))
          }
        }.map { slots =>
          MatchDraftOcrStatus.project(
            draft.status,
            slots.map { case (status, warnings) => MatchDraftOcrSlot(status, warnings) },
          )
        }
      case _ => draft.status.pure[F]

  private def hasWarnings(draft: OcrDraft): Boolean = parse(draft.warningsJson).toOption
    .flatMap(_.asArray).exists(_.nonEmpty)

  private def draftMatchesStatus(
      status: MatchDraftStatus,
      statusFilter: MatchListStatusFilter,
  ): Boolean = statusFilter match
    case MatchListStatusFilter.All => true
    case MatchListStatusFilter.Incomplete => MatchListStatusFilter.incompleteStatuses
        .contains(status)
    case MatchListStatusFilter.OcrRunning => status == MatchDraftStatus.OcrRunning
    case MatchListStatusFilter.PreConfirm =>
      Set(MatchDraftStatus.OcrFailed, MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview)
        .contains(status)
    case MatchListStatusFilter.NeedsReview => status == MatchDraftStatus.NeedsReview
    case MatchListStatusFilter.Confirmed => false
