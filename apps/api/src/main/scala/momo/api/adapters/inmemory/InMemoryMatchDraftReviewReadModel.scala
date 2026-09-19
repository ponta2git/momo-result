package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MatchDraftId
import momo.api.domain.{MatchDraftReview, ScreenType}
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.{MatchDraftReviewReadModel, MatchDraftsRepository, OcrDraftsRepository}

final class InMemoryMatchDraftReviewReadModel[F[_]: Monad](
    matchDrafts: MatchDraftsRepository[F],
    ocrDrafts: OcrDraftsRepository[F],
    images: ImageStorage[F],
) extends MatchDraftReviewReadModel[F]:
  override def find(draftId: MatchDraftId): F[Option[MatchDraftReview]] =
    matchDrafts.find(draftId).flatMap(_.traverse { draft =>
      val kinds = List(ScreenType.TotalAssets, ScreenType.Revenue, ScreenType.IncidentLog)
      val ids = List(draft.totalAssetsDraftId, draft.revenueDraftId, draft.incidentLogDraftId).flatten
      for
        results <- ocrDrafts.findMany(ids)
        sources <- if draft.sourceImagesDeletedAt.nonEmpty then
          List.empty[MatchDraftReview.SourceImage].pure[F]
        else kinds.flatTraverse(kind => draft.sourceImageId(kind).traverse(images.find).map {
            _.flatten.map(image => MatchDraftReview.SourceImage(kind, image.imageId, image.mediaType)).toList
          })
      yield MatchDraftReview(draft, ids.flatMap(results.get), sources)
    })
