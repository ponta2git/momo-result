package momo.api.adapters

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.MatchDraftId
import momo.api.repositories.{
  MatchDraftCancellationRepository, MatchDraftCancellationResult, MatchDraftsRepository,
  OcrJobsRepository,
}

final class InMemoryMatchDraftCancellationRepository[F[_]: Sync](
    matchDrafts: MatchDraftsRepository[F],
    ocrJobs: OcrJobsRepository[F],
) extends MatchDraftCancellationRepository[F]:
  override def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
  ): F[MatchDraftCancellationResult] =
    matchDrafts.find(draftId).flatMap {
      case None => MatchDraftCancellationResult.NotFound.pure[F]
      case Some(draft) if !MatchDraftStatus.nonTerminalStatuses.contains(draft.status) =>
        MatchDraftCancellationResult.NotCancellable(draft.status).pure[F]
      case Some(draft) =>
        matchDrafts.cancel(draftId, updatedAt).flatMap {
          case true => ocrJobs.cancelQueuedByDraftIds(draft.ocrDraftIds, updatedAt)
              .as(MatchDraftCancellationResult.Cancelled(draft.sourceImageIds))
          case false => classifyCurrent(draftId)
        }
    }

  private def classifyCurrent(draftId: MatchDraftId): F[MatchDraftCancellationResult] =
    matchDrafts.find(draftId).map {
      case None => MatchDraftCancellationResult.NotFound
      case Some(draft) => MatchDraftCancellationResult.NotCancellable(draft.status)
    }
end InMemoryMatchDraftCancellationRepository
