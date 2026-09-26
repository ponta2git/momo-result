package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import doobie.Transactor
import doobie.implicits.*

import momo.api.domain.MatchDraft
import momo.api.repositories.{MatchDraftUpdateResult, MatchDraftsRepository}

final class PostgresMatchDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchDraftsRepository[F]:
  private val delegate: MatchDraftsRepository[F] = MatchDraftsRepository
    .fromAlg(PostgresMatchDrafts.alg, transactor.trans)

  export delegate.{
    create,
    find,
    list,
    statsByHeldEvents,
    markOcrFailed,
    attachOcrArtifacts,
    markSourceImagesRetention
  }

  override def update(draft: MatchDraft, updatedAt: Instant): F[MatchDraftUpdateResult] =
    // Translate expected constraint races only after the complete transaction rolled back.
    delegate.update(draft, updatedAt).exceptSomeSqlState {
      case state if isForeignKeyViolation(state) =>
        MatchDraftUpdateResult.PrerequisitesChanged.pure[F]
    }
end PostgresMatchDraftsRepository
