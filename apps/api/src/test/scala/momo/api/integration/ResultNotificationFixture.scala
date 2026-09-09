package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

/** Storage fixture only: application tests own state transition assertions. */
object ResultNotificationFixture:
  val id = "result:test:notification"
  val token = "11111111-1111-4111-8111-111111111111"

  def seed(targetKind: String, targetId: String, now: Instant): ConnectionIO[Unit] =
    val kind = if targetKind == "match" then "analysis_completed" else "ocr_completed"
    for
      _ <- sql"""
        INSERT INTO discord_notifications
          (id, family, kind, dedupe_key, payload, payload_hash, status, claim_token,
           claim_expires_at, part_count, renderer_version)
        VALUES ($id, 'result', $kind, $id, '{}', ${"a" * 64}, 'IN_FLIGHT',
          $token::uuid, ${now.plusSeconds(60)}, 3, 1)
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_results
          (notification_id, kind, source_job_id, occurred_at, settings_generation)
        VALUES ($id, $kind, 'test-job', $now, 0)
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_targets(notification_id, target_kind, target_id)
        VALUES ($id, $targetKind, $targetId)
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_parts
          (notification_id, part_no, status, delivered_message_id, delivered_at, claim_token, send_started_at)
        VALUES ($id, 0, 'DELIVERED', 'sent-0', $now, NULL, $now),
          ($id, 1, 'IN_FLIGHT', NULL, NULL, $token::uuid, $now),
          ($id, 2, 'PENDING', NULL, NULL, NULL, NULL)
      """.update.run
    yield ()

  def state(xa: Transactor[IO]): IO[(String, Option[String], Option[String], List[(String, Option[String])])] =
    (for
      parent <- sql"""
        SELECT status, cancel_reason, claim_token::text FROM discord_notifications WHERE id = $id
      """.query[(String, Option[String], Option[String])].unique
      parts <- sql"""
        SELECT status, delivered_message_id FROM discord_notification_parts
        WHERE notification_id = $id ORDER BY part_no
      """.query[(String, Option[String])].to[List]
    yield (parent._1, parent._2, parent._3, parts)).transact(xa)

  def cancelled(reason: String): (String, Option[String], Option[String], List[(String, Option[String])]) =
    ("CANCELLED", Some(reason), Some(token),
      List(("DELIVERED", Some("sent-0")), ("IN_FLIGHT", None), ("CANCELLED", None)))
end ResultNotificationFixture
