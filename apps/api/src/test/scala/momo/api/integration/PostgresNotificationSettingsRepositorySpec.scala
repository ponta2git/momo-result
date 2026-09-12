package momo.api.integration

import java.time.Instant

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.{
  PostgresNotificationSettings,
  PostgresNotificationSettingsRepository
}
import momo.api.domain.{
  NotificationGeneration,
  NotificationSettingUpdate,
  NotificationSettings,
  NotificationSettingsUpdate
}
import momo.api.errors.AppError

final class PostgresNotificationSettingsRepositorySpec extends IntegrationSuite:
  private val now = Instant.parse("2026-09-10T08:00:00Z")
  private def repo = PostgresNotificationSettingsRepository[IO](transactor)

  private def request(ocr: Boolean, analysis: Boolean): NotificationSettingsUpdate =
    request(ocr, analysis, 0, 0)

  private def request(
      ocr: Boolean,
      analysis: Boolean,
      ocrGeneration: Long
  ): NotificationSettingsUpdate = request(ocr, analysis, ocrGeneration, 0)

  private def request(
      ocr: Boolean,
      analysis: Boolean,
      ocrGeneration: Long,
      analysisGeneration: Long
  ): NotificationSettingsUpdate =
    def generation(value: Long) = NotificationGeneration.fromLong(value).fold(fail(_), identity)
    NotificationSettingsUpdate(
      NotificationSettingUpdate(ocr, generation(ocrGeneration)),
      NotificationSettingUpdate(analysis, generation(analysisGeneration)),
    )

  test("fresh migrations seed both kinds ON at generation zero before fixture cleanup"):
    IO(assertEquals(
      dbFixture().migratedNotificationSettings,
      List(
        ("analysis_completed", true, 0L),
        ("ocr_completed", true, 0L),
      )
    ))

  test("each changed kind advances once; a no-op preserves both generations and update times"):
    for
      first <- repo.update(request(false, true), now)
      beforeNoop <- updateTimes
      noop <- repo.update(request(false, true, 1), now.plusSeconds(10))
      afterNoop <- updateTimes
      second <- repo.update(request(false, false, 1), now.plusSeconds(20))
      restored <- repo.update(request(true, true, 1, 1), now.plusSeconds(30))
    yield
      assertEquals(
        first.map(s => (s.ocrCompleted.generation.value, s.analysisCompleted.generation.value)),
        Right((1L, 0L))
      )
      assertEquals(noop, first)
      assertEquals(afterNoop, beforeNoop)
      assertEquals(
        second.map(s => (s.ocrCompleted.enabled, s.analysisCompleted.enabled)),
        Right((false, false))
      )
      assertEquals(
        restored.map(s => (s.ocrCompleted.generation.value, s.analysisCompleted.generation.value)),
        Right((2L, 2L))
      )

  test(
    "OFF cancels waiting, retry, failed, and claimed parts only for its kind; ON never revives them"
  ):
    for
      _ <- List(
        "pending",
        "retry",
        "failed",
        "claimed",
        "delivered",
        "cancelled",
        "purged",
        "analysis"
      ).traverse_(seedState)
      _ <- repo.update(request(false, true), now)
      disabled <- notificationStates
      _ <- repo.update(request(true, true, 1), now.plusSeconds(1))
      enabled <- notificationStates
    yield
      assertEquals(
        disabled,
        List(
          ("analysis", "PENDING", "PENDING", None),
          ("cancelled", "CANCELLED", "CANCELLED", None),
          ("claimed", "CANCELLED", "CANCELLED", None),
          ("delivered", "DELIVERED", "DELIVERED", None),
          ("failed", "CANCELLED", "CANCELLED", None),
          ("pending", "CANCELLED", "CANCELLED", None),
          ("purged", "FAILED", "PENDING", None),
          ("retry", "CANCELLED", "CANCELLED", None),
        )
      )
      assertEquals(enabled, disabled)

  test("OFF preserves delivered evidence and a part whose send already began"):
    for
      _ <- ResultNotificationFixture.seed("match_draft", "draft", now).transact(transactor)
      _ <- repo.update(request(false, true), now)
      state <- ResultNotificationFixture.state(transactor)
    yield assertEquals(state, ResultNotificationFixture.cancelled("setting_off"))

  test(
    "OFF cancels an entire backlog across batches, including a partially delivered notification"
  ):
    for
      _ <- seedBacklog
      _ <- ResultNotificationFixture.seed("match_draft", "draft", now).transact(transactor)
      _ <- seedState("analysis")
      _ <- repo.update(request(false, true), now)
      states <- notificationStates
      started <- ResultNotificationFixture.state(transactor)
    yield
      val backlog = states.filter(_._1.startsWith("backlog:"))
      assertEquals(backlog.size, 1025)
      assert(backlog.forall { case (_, parent, part, token) =>
        parent == "CANCELLED" && part == "CANCELLED" && token.isEmpty
      })
      assertEquals(
        states.filter(_._1 == "analysis"),
        List(("analysis", "PENDING", "PENDING", None))
      )
      assertEquals(started, ResultNotificationFixture.cancelled("setting_off"))

  test("a conflict on either kind leaves both settings and pending notifications unchanged"):
    for
      _ <- seedState("pending")
      _ <- repo.update(request(true, false), now)
      before <- repo.get
      notificationsBefore <- notificationStates
      result <- repo.update(request(false, true), now.plusSeconds(1))
      after <- repo.get
      notificationsAfter <- notificationStates
    yield
      assertEquals(result, Left(AppError.NotificationSettingsVersionConflict()))
      assertEquals(after, before)
      assertEquals(notificationsAfter, notificationsBefore)

  test("failure after both writes and cancellation rolls back the complete command"):
    for
      _ <- seedBacklog
      _ <- ResultNotificationFixture.seed("match_draft", "draft", now).transact(transactor)
      before <- ResultNotificationFixture.state(transactor)
      notificationsBefore <- notificationStates
      result <-
      (PostgresNotificationSettings.update(request(false, false), now) *>
        new IllegalStateException("abort settings command").raiseError[
          ConnectionIO,
          Unit
        ]).transact(transactor).attempt
      settings <- repo.get
      after <- ResultNotificationFixture.state(transactor)
      notificationsAfter <- notificationStates
    yield
      assertEquals(result.left.map(_.getMessage), Left("abort settings command"))
      assertEquals(settings, NotificationSettings.initial)
      assertEquals(after, before)
      assertEquals(notificationsAfter, notificationsBefore)

  test("concurrent saves wait at the consumer gate and re-read the committed generations"):
    for
      locked <- Deferred[IO, Int]
      release <- Deferred[IO, Unit]
      holder <- holdGateAndSave(locked, release).start
      pid <- locked.get
      waiter <- repo.update(request(true, false), now.plusSeconds(1)).start
      visible <- (awaitBackendBlockedBy(pid) *> repo.get).guarantee(release.complete(()).void)
      first <- holder.joinWithNever
      second <- waiter.joinWithNever
      saved <- repo.get
    yield
      assertEquals(visible, NotificationSettings.initial)
      assert(first.isRight)
      assertEquals(second, Left(AppError.NotificationSettingsVersionConflict()))
      assertEquals((saved.ocrCompleted.enabled, saved.analysisCompleted.enabled), (false, true))

  private def holdGateAndSave(
      locked: Deferred[IO, Int],
      release: Deferred[IO, Unit]
  ): IO[Either[AppError, NotificationSettings]] =
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
      val xa = Transactor.fromConnection[IO](connection, None)
      (for
        _ <- IO.blocking(connection.setAutoCommit(false))
        result <- xa.rawTrans.apply(PostgresNotificationSettings.update(request(false, true), now))
        pid <- xa.rawTrans.apply(sql"SELECT pg_backend_pid()".query[Int].unique)
        _ <- locked.complete(pid)
        _ <- release.get
        _ <- IO.blocking(connection.commit())
      yield result).onError(_ => IO.blocking(connection.rollback()))
    }

  private def updateTimes: IO[List[Instant]] =
    sql"SELECT updated_at FROM discord_notification_settings ORDER BY kind".query[
      Instant
    ].to[List].transact(transactor)

  private def seedBacklog: IO[Unit] =
    (for
      _ <- sql"""
        INSERT INTO discord_notifications
          (id, family, kind, dedupe_key, payload, payload_hash, part_count, renderer_version)
        SELECT 'backlog:' || i, 'result', 'ocr_completed', 'backlog:' || i, '{}', ${"a" * 64}, 1, 1
        FROM generate_series(1, 1025) i
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_results
          (notification_id, kind, source_job_id, occurred_at, settings_generation)
        SELECT id, kind, id, $now, 0 FROM discord_notifications WHERE id LIKE 'backlog:%'
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_parts(notification_id, part_no)
        SELECT id, 0 FROM discord_notifications WHERE id LIKE 'backlog:%'
      """.update.run
    yield ()).transact(transactor)

  private def seedState(id: String): IO[Unit] =
    val kind = if id == "analysis" then "analysis_completed" else "ocr_completed"
    val status = id match
      case "claimed" => "IN_FLIGHT"
      case "delivered" => "DELIVERED"
      case "cancelled" => "CANCELLED"
      case "failed" | "purged" => "FAILED"
      case _ => "PENDING"
    val partStatus = if Set("DELIVERED", "CANCELLED").contains(status) then status else "PENDING"
    val token = Option.when(id == "claimed")(ResultNotificationFixture.token)
    val expiry = token.map(_ => now.plusSeconds(60))
    val purged = Option.when(id == "purged")(now)
    val payload = Option.when(id != "purged")("{}")
    (for
      _ <-
        sql"""
        INSERT INTO discord_notifications(id, family, kind, dedupe_key, payload, payload_hash, status,
          claim_token, claim_expires_at, part_count, renderer_version, next_attempt_at, purged_at)
        VALUES ($id, 'result', $kind, $id, $payload::jsonb, ${"a" * 64}, $status,
          $token::uuid, $expiry, 1, 1, ${now.plusSeconds(3600)}, $purged)
      """.update.run
      _ <-
        sql"""
        INSERT INTO discord_notification_results(notification_id, kind, source_job_id, occurred_at, settings_generation)
        VALUES ($id, $kind, $id, $now, 0)
      """.update.run
      _ <- sql"""
        INSERT INTO discord_notification_parts(notification_id, part_no, status)
        VALUES ($id, 0, $partStatus)
      """.update.run
    yield ()).transact(transactor)

  private def notificationStates: IO[List[(String, String, String, Option[String])]] = sql"""
    SELECT n.id, n.status, p.status, n.claim_token::text FROM discord_notifications n
    JOIN discord_notification_parts p ON p.notification_id = n.id ORDER BY n.id
  """.query[(String, String, String, Option[String])].to[List].transact(transactor)
end PostgresNotificationSettingsRepositorySpec
