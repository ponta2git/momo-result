package momo.api.adapters.postgres

import cats.MonadThrow
import doobie.*
import doobie.enumerated.SqlState
import doobie.implicits.*
import doobie.postgres.sqlstate

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.MatchDraftStatus
import momo.api.errors.{AppError, AppException}

private[postgres] val RestrictViolationSqlState = "23001"

private[postgres] def isForeignKeyViolation(state: SqlState): Boolean =
  state.value == sqlstate.class23.FOREIGN_KEY_VIOLATION.value ||
    state.value == RestrictViolationSqlState

private[postgres] def isUniqueViolation(state: SqlState): Boolean = state.value ==
  sqlstate.class23.UNIQUE_VIOLATION.value

private[postgres] def appError[A](error: AppError): ConnectionIO[A] = MonadThrow[ConnectionIO]
  .raiseError[A](new AppException(error))

private[postgres] def conflict[A](message: String): ConnectionIO[A] =
  appError(AppError.Conflict(message))

private[postgres] def notFound[A](resource: String, id: String): ConnectionIO[A] =
  appError(AppError.NotFound(resource, id))

private[postgres] def deleteDiscardedDrafts(where: Fragment): ConnectionIO[Int] =
  (fr"DELETE FROM match_drafts WHERE" ++ where ++ fr"""
    AND (
      status = ${MatchDraftStatus.Cancelled}
      OR (status = ${MatchDraftStatus.Confirmed} AND confirmed_match_id IS NULL)
    )
  """).update.run
