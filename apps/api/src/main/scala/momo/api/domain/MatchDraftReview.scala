package momo.api.domain

import momo.api.domain.ids.ImageId

/** One committed view of the working draft and only the artifacts it currently references. */
final case class MatchDraftReview(
    draft: MatchDraft,
    ocrDrafts: List[OcrDraft],
    sourceImages: List[MatchDraftReview.SourceImage],
)

object MatchDraftReview:
  final case class SourceImage(kind: ScreenType, imageId: ImageId, mediaType: String)
