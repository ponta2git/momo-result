package momo.api.repositories

import java.time.Instant
import momo.api.domain.MatchRecord

trait MatchConfirmationRepository[F[_]]:
  def confirm(record: MatchRecord, draftId: Option[String], updatedAt: Instant): F[Boolean]
