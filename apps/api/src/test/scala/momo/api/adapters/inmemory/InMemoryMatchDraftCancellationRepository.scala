package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*

import momo.api.domain.ids.{AccountId, MatchDraftId}
import momo.api.repositories.{
  MatchDraftCancellationRepository,
  MatchDraftCancellationResult,
  OcrJobsRepository
}

final class InMemoryMatchDraftCancellationRepository[F[_]: Sync](
    matchDrafts: InMemoryMatchDraftsRepository[F],
    ocrJobs: OcrJobsRepository[F],
) extends MatchDraftCancellationRepository[F]:
  override def cancelDraftAndQueuedOcrJobs(
      draftId: MatchDraftId,
      updatedAt: Instant,
      actorAccountId: AccountId,
  ): F[MatchDraftCancellationResult] = Sync[F].uncancelable { _ =>
    matchDrafts.takeForCancellation(draftId, actorAccountId).flatMap {
      case Left(result) => result.pure[F]
      case Right(draft) =>
        ocrJobs.cancelQueuedByDraftIds(draft.ocrDraftIds, updatedAt)
          .as(MatchDraftCancellationResult.Cancelled(draft.sourceImageIds))
    }
  }
end InMemoryMatchDraftCancellationRepository
