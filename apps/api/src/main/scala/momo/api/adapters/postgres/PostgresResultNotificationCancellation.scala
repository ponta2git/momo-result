package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ResultNotificationKind
import momo.api.domain.ids.{MatchDraftId, MatchId}

/**
 * Part of the source command's ConnectionIO program, never a separate transaction.
 * Call after all source writes. Summit uses this same gate before receipt/begin and
 * never locks source rows after it; READ COMMITTED observes the winning source change.
 */
private[postgres] object PostgresResultNotificationCancellation:
  private val BatchSize = 256

  def acquireGate: ConnectionIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(19790514, 1)".query[Unit].unique

  /** The setting command already holds the gate and decided which kinds became OFF. */
  def settingsDisabled(kinds: List[ResultNotificationKind], now: Instant): ConnectionIO[Unit] =
    if kinds.isEmpty then ().pure[ConnectionIO]
    else
      cancelMatching(
        fr"""EXISTS (
          SELECT 1 FROM discord_notification_results r
          WHERE r.notification_id = n.id AND r.kind = ANY(${kinds.map(_.wire).toArray})
        )""",
        "setting_off",
        now,
      )

  def draftsUnavailable(ids: List[MatchDraftId], now: Instant): ConnectionIO[Unit] =
    cancelTargets("match_draft", ids.map(_.value), "draft_unavailable", now)

  def afterDeletion(drafts: List[MatchDraftId], matches: List[MatchId]): ConnectionIO[Unit] =
    if drafts.isEmpty && matches.isEmpty then ().pure[ConnectionIO]
    else
      for
        now <- sql"SELECT transaction_timestamp()".query[Instant].unique
        _ <- draftsUnavailable(drafts, now)
        _ <- cancelTargets("match", matches.map(_.value), "match_deleted", now)
      yield ()

  private def cancelTargets(
      kind: String,
      ids: List[String],
      reason: String,
      now: Instant,
  ): ConnectionIO[Unit] =
    if ids.isEmpty then ().pure[ConnectionIO]
    else
      acquireGate *> cancelMatching(
        fr"""EXISTS (
          SELECT 1 FROM discord_notification_targets t
          WHERE t.notification_id = n.id AND t.target_kind = $kind
            AND t.target_id = ANY(${ids.toArray})
        )""",
        reason,
        now,
      )

  /** Bound memory and DB round trips while keeping every batch inside the caller's transaction. */
  private def cancelMatching(
      target: Fragment,
      reason: String,
      now: Instant,
  ): ConnectionIO[Unit] =
    def loop(after: Option[String]): ConnectionIO[Unit] =
      val boundary = after.fold(Fragment.empty)(id => fr"AND n.id > $id")
      (fr"""
        SELECT n.id FROM discord_notifications n
        WHERE n.family = 'result' AND n.purged_at IS NULL
          AND n.status IN ('PENDING', 'IN_FLIGHT', 'FAILED') AND
      """ ++ target ++ boundary ++ fr"ORDER BY n.id LIMIT $BatchSize FOR UPDATE OF n")
        .query[String].to[List].flatMap { ids =>
          if ids.isEmpty then ().pure[ConnectionIO]
          else
            cancelLocked(ids, reason, now) *>
              (if ids.size < BatchSize then ().pure[ConnectionIO] else loop(ids.lastOption))
        }
    loop(None)

  private def cancelLocked(ids: List[String], reason: String, now: Instant): ConnectionIO[Unit] =
    for
      _ <- sql"""
        UPDATE discord_notification_parts SET status = 'CANCELLED', claim_token = NULL
        WHERE notification_id = ANY(${ids.toArray}) AND status = 'PENDING'
      """.update.run
      // Read parts after acquiring parent locks: a delivery may have committed while we waited.
      sending <- sql"""
        SELECT DISTINCT notification_id FROM discord_notification_parts
        WHERE notification_id = ANY(${ids.toArray}) AND status = 'IN_FLIGHT'
      """.query[String].to[Set]
      (started, unstarted) = ids.partition(sending.contains)
      _ <- markCancelled(started, reason, now, releaseClaim = false)
      _ <- markCancelled(unstarted, reason, now, releaseClaim = true)
    yield ()

  private def markCancelled(
      ids: List[String],
      reason: String,
      now: Instant,
      releaseClaim: Boolean,
  ): ConnectionIO[Unit] =
    if ids.isEmpty then ().pure[ConnectionIO]
    else
      val claim = if releaseClaim then fr", claim_token = NULL, claim_expires_at = NULL"
      else Fragment.empty
      (fr"""
        UPDATE discord_notifications SET status = 'CANCELLED', cancel_reason = $reason,
          terminal_at = $now, updated_at = $now
      """ ++ claim ++ fr"WHERE id = ANY(${ids.toArray})").update.run.void
end PostgresResultNotificationCancellation
