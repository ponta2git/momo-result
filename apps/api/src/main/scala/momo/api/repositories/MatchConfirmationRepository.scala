package momo.api.repositories

import java.time.Instant

import momo.api.domain.MatchRecord
import momo.api.domain.ids.MatchDraftId

trait MatchConfirmationRepository[F[_]]:
  def confirm(record: MatchRecord, draftId: Option[MatchDraftId], updatedAt: Instant): F[Boolean]
