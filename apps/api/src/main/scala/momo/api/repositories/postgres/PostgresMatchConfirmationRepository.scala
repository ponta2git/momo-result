package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraftStatus, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.MatchConfirmationRepository
import momo.api.repositories.postgres.PostgresMatchInsertOps.insertMatchCascade
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresMatchConfirmationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchConfirmationRepository[F]:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  override def confirm(
      record: MatchRecord,
      draftId: Option[MatchDraftId],
      updatedAt: Instant,
  ): F[Boolean] =
    val program =
      for
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
        _ <-
          if updated then
            insertMatchCascade(record, updatedAt).exceptSomeSqlState {
              case state if isUniqueViolation(state) =>
                conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
                    .toString} already exists for held event ${record.heldEventId.value}.")
            }
          else ().pure[ConnectionIO]
      yield updated
    program.transact(transactor)
