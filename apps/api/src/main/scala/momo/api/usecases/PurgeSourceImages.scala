package momo.api.usecases

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.domain.ids.MatchDraftId
import momo.api.repositories.{ImageStore, MatchDraftsRepository}

final class PurgeSourceImages[F[_]: Sync](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  private val logger = LoggerFactory.getLogger("momo.api.usecases.PurgeSourceImages")

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

  def runBestEffort(draftId: MatchDraftId, now: Instant): F[Unit] = run(draftId, now)
    .handleErrorWith { error =>
      Sync[F].delay(logger.error(
        s"Source image retention cleanup failed draftId=${draftId.value} errorClass=${error.getClass
            .getName}",
        error,
      ))
    }

  private def deleteSourceImages(draft: momo.api.domain.MatchDraft): F[Unit] =
    List(draft.totalAssetsImageId, draft.revenueImageId, draft.incidentLogImageId).flatten.distinct
      .traverse_(rawId => imageStore.delete(rawId).void)
