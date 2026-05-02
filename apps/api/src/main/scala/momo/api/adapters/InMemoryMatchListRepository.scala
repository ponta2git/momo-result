package momo.api.adapters

import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.Monad
import momo.api.domain.{MatchDraftStatus, MatchListItem, MatchListItemKind, MatchListRankEntry}
import momo.api.repositories.{MatchDraftsRepository, MatchListRepository, MatchesRepository}

final class InMemoryMatchListRepository[F[_]: Monad](
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends MatchListRepository[F]:
  override def list(filter: MatchListRepository.Filter): F[List[MatchListItem]] =
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
          id = record.id,
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
          ranks = record.players.sortBy(_.playOrder)
            .map(p => MatchListRankEntry(p.memberId, p.rank, p.playOrder)),
        )
      }

      val draftItems = drafts.filterNot(d =>
        d.status == MatchDraftStatus.Cancelled || d.status == MatchDraftStatus.Confirmed
      ).filter(draftMatchesStatus(_, filter.status)).map { draft =>
        MatchListItem(
          kind = MatchListItemKind.MatchDraft,
          id = draft.id,
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
        case MatchListRepository.KindFilter.Match => confirmedItems
        case MatchListRepository.KindFilter.MatchDraft => draftItems
        case MatchListRepository.KindFilter.All => filter.status match
            case MatchListRepository.StatusFilter.Confirmed => confirmedItems
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
      statusFilter: MatchListRepository.StatusFilter,
  ): Boolean = statusFilter match
    case MatchListRepository.StatusFilter.All => true
    case MatchListRepository.StatusFilter.Incomplete => MatchListRepository.IncompleteStatuses
        .contains(draft.status)
    case MatchListRepository.StatusFilter.OcrRunning => draft.status == MatchDraftStatus.OcrRunning
    case MatchListRepository.StatusFilter.PreConfirm =>
      Set(MatchDraftStatus.OcrFailed, MatchDraftStatus.DraftReady, MatchDraftStatus.NeedsReview)
        .contains(draft.status)
    case MatchListRepository.StatusFilter.NeedsReview => draft.status ==
        MatchDraftStatus.NeedsReview
    case MatchListRepository.StatusFilter.Confirmed => false
