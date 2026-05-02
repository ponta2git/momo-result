package momo.api.usecases

import cats.syntax.functor.*
import cats.Monad
import java.time.Instant
import momo.api.repositories.MatchDraftsRepository

final class SourceImageRetentionService[F[_]: Monad](matchDrafts: MatchDraftsRepository[F]):
  def markForCleanup(draftId: String, now: Instant): F[Unit] = matchDrafts
    .markSourceImagesRetention(
      draftId = draftId,
      retainedUntil = Some(now),
      deletedAt = None,
      updatedAt = now,
    ).void
