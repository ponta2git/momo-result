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
  def acquireGate: ConnectionIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(19790514, 1)".query[Unit].unique

  /** The setting command already holds the gate and decided which kinds became OFF. */
  def settingsDisabled(kinds: List[ResultNotificationKind], now: Instant): ConnectionIO[Unit] =
    if kinds.isEmpty then ().pure[ConnectionIO]
    else
      for
        ids <- sql"""
          SELECT n.id FROM discord_notifications n
          JOIN discord_notification_results r ON r.notification_id = n.id
          WHERE r.kind = ANY(${kinds.map(_.wire).toArray})
            AND n.family = 'result' AND n.purged_at IS NULL
            AND n.status IN ('PENDING', 'IN_FLIGHT', 'FAILED')
          ORDER BY n.id
        """.query[String].to[List]
        _ <- ids.traverse_(cancel(_, "setting_off", now))
      yield ()

  private final case class Notification(
      status: String,
      purgedAt: Option[Instant],
      claimToken: Option[String],
      claimExpiresAt: Option[Instant],
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
      for
        _ <- acquireGate
        notificationIds <- sql"""
          SELECT DISTINCT notification_id FROM discord_notification_targets
          WHERE target_kind = $kind AND target_id = ANY(${ids.toArray})
          ORDER BY notification_id
        """.query[String].to[List]
        _ <- notificationIds.traverse_(cancel(_, reason, now))
      yield ()

  private def cancel(id: String, reason: String, now: Instant): ConnectionIO[Unit] =
    sql"""
      SELECT status, purged_at, claim_token::text, claim_expires_at
      FROM discord_notifications WHERE id = $id AND family = 'result' FOR UPDATE
    """.query[Notification].option.flatMap {
      case Some(n) if n.status != "DELIVERED" && n.status != "CANCELLED" && n.purgedAt.isEmpty =>
        for
          _ <- sql"""
            UPDATE discord_notification_parts SET status = 'CANCELLED', claim_token = NULL
            WHERE notification_id = $id AND status = 'PENDING'
          """.update.run
          sending <- sql"""
            SELECT EXISTS (SELECT 1 FROM discord_notification_parts
              WHERE notification_id = $id AND status = 'IN_FLIGHT')
          """.query[Boolean].unique
          token = n.claimToken.filter(_ => sending)
          expiry = n.claimExpiresAt.filter(_ => sending)
          _ <- sql"""
            UPDATE discord_notifications SET status = 'CANCELLED', cancel_reason = $reason,
              terminal_at = $now, updated_at = $now,
              claim_token = $token::uuid, claim_expires_at = $expiry
            WHERE id = $id
          """.update.run
        yield ()
      case _ => ().pure[ConnectionIO]
    }
end PostgresResultNotificationCancellation
