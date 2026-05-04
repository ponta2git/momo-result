package momo.api.adapters

import cats.Monad
import cats.syntax.flatMap.*
import cats.syntax.functor.*

import momo.api.domain.{MatchDraftStatus, MatchListItem, MatchListItemKind, MatchListRankEntry}
import momo.api.repositories.{MatchDraftsRepository, MatchListReadModel, MatchesRepository}

final class InMemoryMatchListReadModel[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends MatchListReadModel[F]:
  override def list(filter: MatchListReadModel.Filter): F[List[MatchListItem]] =
    for
      confirmed <- matches.list(MatchesRepository.ListFilter(
        heldEventId = filter.heldEventId,
        gameTitleId = filter.gameTitleId,
        seasonMasterId = filter.seasonMasterId,
        limit = None,
      ))
      drafts <- matchDrafts.list(MatchDraftsRepository.ListFilter(
        heldEventId = filter.heldEventId,
        gameTitleId = filter.gameTitleId,
        seasonMasterId = filter.seasonMasterId,
        limit = None,
      ))
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

      val draftItems = drafts.filterNot(d =>
        d.status == MatchDraftStatus.Cancelled || d.status == MatchDraftStatus.Confirmed
      ).filter(draftMatchesStatus(_, filter.status)).map { draft =>
        MatchListItem(
          kind = MatchListItemKind.MatchDraft,
          id = draft.id.value,
          matchId = None,
          matchDraftId = Some(draft.id),
          status = draft.status.wire,
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

      val combined = filter.kind match
        case MatchListReadModel.KindFilter.Match => confirmedItems
        case MatchListReadModel.KindFilter.MatchDraft => draftItems
        case MatchListReadModel.KindFilter.All => filter.status match
            case MatchListReadModel.StatusFilter.Confirmed => confirmedItems
            case _ => confirmedItems ++ draftItems
      val ordered = combined.sortBy(i =>
        (
          -i.playedAt.getOrElse(i.updatedAt).toEpochMilli,
          -i.updatedAt.toEpochMilli,
          -i.createdAt.toEpochMilli,
        )
      )
      filter.limit.fold(ordered)(ordered.take)

  private def draftMatchesStatus(
      draft: momo.api.domain.MatchDraft,
      statusFilter: MatchListReadModel.StatusFilter,
  ): Boolean = statusFilter match
    case MatchListReadModel.StatusFilter.All => true
    case MatchListReadModel.StatusFilter.Incomplete => MatchListReadModel.IncompleteStatuses
        .contains(draft.status)
    case MatchListReadModel.StatusFilter.OcrRunning => draft.status == MatchDraftStatus.OcrRunning
    case MatchListReadModel.StatusFilter.PreConfirm =>
      Set(MatchDraftStatus.OcrFailed, MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview)
        .contains(draft.status)
    case MatchListReadModel.StatusFilter.NeedsReview => draft.status == MatchDraftStatus.NeedsReview
    case MatchListReadModel.StatusFilter.Confirmed => false
