package momo.api.usecases

import java.time.Instant

import cats.effect.Sync
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.domain.ids.{ImageId, MatchDraftId}
import momo.api.logging.SafeLog
import momo.api.repositories.{ImageStore, MatchDraftsRepository}

final class PurgeSourceImages[F[_]: Sync](
    matchDrafts: MatchDraftsRepository[F],
    imageStore: ImageStore[F],
):
  private val logger = LoggerFactory.getLogger("momo.api.usecases.PurgeSourceImages")

  def run(draftId: MatchDraftId, now: Instant): F[Unit] =
    for
      maybeDraft <- matchDrafts.find(draftId)
      _ <- maybeDraft.traverse_(draft =>
        matchDrafts.markSourceImagesRetention(
          draftId = draftId,
          retainedUntil = Some(now),
          deletedAt = Some(now),
          updatedAt = now,
        ).flatMap(marked => deleteSourceImages(draft).whenA(marked))
      )
    yield ()

  def runBestEffort(draftId: MatchDraftId, now: Instant): F[Unit] = run(draftId, now)
    .handleErrorWith { error =>
      val classes = SafeLog.throwableClasses(error)
      Sync[F].delay(logger.error(s"Source image retention cleanup failed draftId=${draftId
          .value} errorClasses=$classes"))
    }

  def deleteKnownBestEffort(draftId: MatchDraftId, imageIds: List[ImageId]): F[Unit] =
    deleteSourceImages(imageIds).handleErrorWith { error =>
      val classes = SafeLog.throwableClasses(error)
      Sync[F].delay(logger.error(s"Source image delete failed draftId=${draftId
          .value} errorClasses=$classes"))
    }

  private def deleteSourceImages(draft: momo.api.domain.MatchDraft): F[Unit] =
    deleteSourceImages(draft.sourceImageIds)

  private def deleteSourceImages(imageIds: List[ImageId]): F[Unit] = imageIds.distinct
    .traverse_(rawId => imageStore.delete(rawId).void)
