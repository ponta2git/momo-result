package momo.api.adapters

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.ImageId
import momo.api.repositories.{ImageReferenceRepository, MatchDraftsRepository}

final class InMemoryImageReferenceRepository[F[_]: Monad](
    activeJobImageIds: F[Set[ImageId]],
    matchDrafts: MatchDraftsRepository[F],
) extends ImageReferenceRepository[F]:
  override def referencedImageIds: F[Set[ImageId]] =
    for
      jobImages <- activeJobImageIds
      drafts <- matchDrafts.list(MatchDraftsRepository.ListFilter())
      draftImages = drafts.filter(draft =>
        draft.sourceImagesDeletedAt.isEmpty &&
          !MatchDraftStatus.terminalStatuses.contains(draft.status)
      ).flatMap(_.sourceImageIds).toSet
    yield jobImages ++ draftImages

object InMemoryImageReferenceRepository:
  def apply[F[_]: Monad](
      jobs: InMemoryOcrJobsRepository[F],
      matchDrafts: MatchDraftsRepository[F],
  ): InMemoryImageReferenceRepository[F] =
    new InMemoryImageReferenceRepository(jobs.activeImageIds, matchDrafts)
