package momo.api.repositories

import momo.api.domain.MatchDraftReview
import momo.api.domain.ids.MatchDraftId

trait MatchDraftReviewReadModel[F[_]]:
  def find(draftId: MatchDraftId): F[Option[MatchDraftReview]]
