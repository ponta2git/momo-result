package momo.api.usecases

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MatchDraftId
import momo.api.repositories.{ImageStore, MatchDraftsRepository}

final class PurgeSourceImages[F[_]: Monad](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  def run(draftId: MatchDraftId, now: Instant): F[Unit] =
    for
      maybeDraft <- matchDrafts.find(draftId)
      _ <- maybeDraft.traverse_(deleteSourceImages)
      _ <- matchDrafts.markSourceImagesRetention(
        draftId = draftId,
        retainedUntil = Some(now),
        deletedAt = Some(now),
        updatedAt = now,
      )
    yield ()

  private def deleteSourceImages(draft: momo.api.domain.MatchDraft): F[Unit] =
    List(draft.totalAssetsImageId, draft.revenueImageId, draft.incidentLogImageId).flatten.distinct
      .traverse_(rawId => imageStore.delete(rawId).void)
