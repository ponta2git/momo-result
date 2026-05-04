package momo.api.usecases

import cats.Monad
import cats.syntax.all.*
import java.time.Instant
import momo.api.domain.ids.ImageId
import momo.api.repositories.{ImageStore, MatchDraftsRepository}

final class SourceImageRetentionService[F[_]: Monad](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  def cleanupNow(draftId: String, now: Instant): F[Unit] = for
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
    List(
      draft.totalAssetsImageId,
      draft.revenueImageId,
      draft.incidentLogImageId,
    ).flatten.distinct.traverse_(rawId => imageStore.delete(ImageId(rawId)).void)
