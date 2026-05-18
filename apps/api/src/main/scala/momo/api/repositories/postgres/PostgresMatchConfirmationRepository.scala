package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.applicative.*
import cats.syntax.apply.*
import cats.syntax.functor.*
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.postgres.sqlstate

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraftStatus, MatchRecord}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.PostgresMatchInsertOps.insertMatchCascade
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{MatchConfirmationRepository, MatchDraftConfirmation}

final class PostgresMatchConfirmationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends MatchConfirmationRepository[F]:
  private def isUniqueViolation(state: SqlState): Boolean = state.value ==
    sqlstate.class23.UNIQUE_VIOLATION.value

  private def conflict[A](detail: String): ConnectionIO[A] = MonadThrow[ConnectionIO]
    .raiseError[A](new AppException(AppError.Conflict(detail)))

  override def confirm(
      record: MatchRecord,
      draft: Option[MatchDraftConfirmation],
      updatedAt: Instant,
  ): F[Boolean] =
    val program = draft match
      case None => insert(record, updatedAt).as(true)
      case Some(expected) =>
        for
          updated <- sql"""
            UPDATE match_drafts SET
              status = ${MatchDraftStatus.Confirmed},
              updated_at = $updatedAt
            WHERE id = ${expected.draftId}
              AND updated_at = ${expected.updatedAt}
              AND total_assets_draft_id IS NOT DISTINCT FROM ${expected.totalAssetsDraftId}
              AND revenue_draft_id IS NOT DISTINCT FROM ${expected.revenueDraftId}
              AND incident_log_draft_id IS NOT DISTINCT FROM ${expected.incidentLogDraftId}
              AND status IN (${MatchDraftStatus.DraftReady}, ${MatchDraftStatus
              .NeedsReview}, ${MatchDraftStatus.OcrFailed})
          """.update.run.map(_ > 0)
          _ <-
            if updated then insert(record, updatedAt) *> attachConfirmedMatch(expected, record)
            else ().pure[ConnectionIO]
        yield updated
    program.transact(transactor)

  private def insert(record: MatchRecord, updatedAt: Instant): ConnectionIO[Unit] =
    insertMatchCascade(record, updatedAt).exceptSomeSqlState {
      case state if isUniqueViolation(state) =>
        conflict[Unit](s"matchNoInEvent ${record.matchNoInEvent.value
            .toString} already exists for held event ${record.heldEventId.value}.")
    }

  private def attachConfirmedMatch(
      expected: MatchDraftConfirmation,
      record: MatchRecord,
  ): ConnectionIO[Unit] = sql"""
      UPDATE match_drafts SET confirmed_match_id = ${record.id}
      WHERE id = ${expected.draftId}
    """.update.run.flatMap {
    case 1 => ().pure[ConnectionIO]
    case affected => MonadThrow[ConnectionIO]
        .raiseError[Unit](IllegalStateException(s"expected to attach confirmed match ${record
            .id} to draft ${expected.draftId}, but updated $affected rows"))
  }
