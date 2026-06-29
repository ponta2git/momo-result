package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*
import io.circe.parser.parse

import momo.api.domain.matchlist.MatchListProjection
import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{
  MatchDraft,
  MatchDraftOcrSlot,
  MatchDraftOcrStatus,
  MatchDraftStatus,
  MatchListItem,
  MatchListItemKind,
  MatchListKindFilter,
  MatchListRankEntry,
  MatchListStatusFilter,
  MatchListSummary,
  OcrDraft,
  OcrJobStatus,
  PagedResult
}
import momo.api.repositories.{
  MatchDraftsRepository,
  MatchListReadModel,
  MatchesRepository,
  OcrDraftsRepository,
  OcrJobsRepository
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
    val ordered = MatchListProjection.sortItems(combined, filter.sort)
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
    MatchListProjection.summarizeDraftStatuses(items.flatMap(item =>
      MatchDraftStatus.fromWire(item.status)
    ))
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
        )
      }

      val includeMatches = MatchListProjection.includeMatches(kind, statusFilter)
      val includeDrafts = MatchListProjection.includeDrafts(kind, statusFilter)
      (includeMatches, includeDrafts) match
        case (true, true) => confirmedItems ++ draftItems
        case (true, false) => confirmedItems
        case (false, true) => draftItems
        case (false, false) => Nil

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
