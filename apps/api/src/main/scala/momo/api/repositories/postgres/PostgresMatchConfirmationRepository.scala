package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraftStatus, MatchRecord}
import momo.api.repositories.MatchConfirmationRepository
import momo.api.repositories.postgres.PostgresMatchInsertOps.insertMatchCascade
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresMatchConfirmationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchConfirmationRepository[F]:

  override def confirm(
      record: MatchRecord,
      draftId: Option[MatchDraftId],
      updatedAt: Instant,
  ): F[Boolean] =
    val program =
      for
        _ <- insertMatchCascade(record, updatedAt)
        updated <- draftId match
          case None => true.pure[ConnectionIO]
          case Some(id) => sql"""
            UPDATE match_drafts SET
              status = ${MatchDraftStatus.Confirmed},
              confirmed_match_id = ${record.id},
              updated_at = $updatedAt
            WHERE id = $id
              AND status IN (${MatchDraftStatus.DraftReady}, ${MatchDraftStatus
                .NeedsReview}, ${MatchDraftStatus.OcrFailed})
          """.update.run.map(_ > 0)
      yield updated
    program.transact(transactor)
