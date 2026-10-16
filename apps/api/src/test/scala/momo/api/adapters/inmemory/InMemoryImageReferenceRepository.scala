package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.ImageId
import momo.api.repositories.ImageReferenceRepository

final class InMemoryImageReferenceRepository[F[_]: Monad](
    activeJobImageIds: F[Set[ImageId]],
    matchDrafts: MatchDraftFixtureStore[F],
) extends ImageReferenceRepository[F]:
  override def referencedImageIds: F[Set[ImageId]] =
    for
      jobImages <- activeJobImageIds
      drafts <- matchDrafts.list(MatchDraftFixtureStore.ListFilter())
      draftImages = drafts.filter(draft =>
        draft.sourceImagesDeletedAt.isEmpty &&
          !MatchDraftStatus.terminalStatuses.contains(draft.status)
      ).flatMap(_.sourceImageIds).toSet
    yield jobImages ++ draftImages

object InMemoryImageReferenceRepository:
  def apply[F[_]: Monad](
      jobs: InMemoryOcrJobsRepository[F],
      matchDrafts: MatchDraftFixtureStore[F],
  ): InMemoryImageReferenceRepository[F] =
    new InMemoryImageReferenceRepository(jobs.activeImageIds, matchDrafts)
