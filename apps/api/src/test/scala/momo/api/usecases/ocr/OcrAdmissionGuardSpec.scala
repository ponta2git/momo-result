package momo.api.usecases.ocr

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, IO}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.errors.AppError
import momo.api.repositories.OcrQueueBacklogSnapshot
import momo.api.testing.{
  FailingOcrJobQueueHealthCheck,
  FixedClock,
  RecordingOcrQueueOutboxRepository,
  StaticOcrJobQueueHealthCheck
}

final class OcrAdmissionGuardSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val now = Instant.parse("2026-05-19T12:00:00Z")
  private val config = OcrAdmissionGuard.Config(
    dueBacklogLimit = 24,
    activeBacklogLimit = 48,
    oldestDueMaxDelay = 10.minutes,
    deadLetterBacklogLimit = 24,
  )
  private val emptySnapshot = OcrQueueBacklogSnapshot(
    pendingCount = 0,
    inFlightCount = 0,
    expiredInFlightCount = 0,
    duePendingCount = 0,
    oldestDueNextAttemptAt = None,
    recoverableInvalidCount = 0,
  )

  test("allows OCR admission below backlog thresholds"):
    for
      repo <- repoWithSnapshot(OcrQueueBacklogSnapshot(
        pendingCount = 4,
        inFlightCount = 1,
        expiredInFlightCount = 0,
        duePendingCount = 1,
        oldestDueNextAttemptAt = Some(now.minusSeconds(60)),
        recoverableInvalidCount = 0,
      ))
      guard = guardAt(repo, StaticOcrJobQueueHealthCheck(deadLetterLengthValue = 0L), config)
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertEquals(result, Right(()))
      assertEquals(health, "ok")

  test("rejects when Redis is unavailable before reading outbox state"):
    val redisError = RuntimeException("redis://secret-host/down")
    for
      repo <- repoWithSnapshot(emptySnapshot)
      guard = guardAt(
        repo,
        FailingOcrJobQueueHealthCheck(Some(redisError), deadLetterLengthError = None),
        config,
      )
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertServiceUnavailable(result)
      assertEquals(health, "degraded:redis_unavailable")

  test("rejects when due outbox backlog exceeds the configured limit"):
    for
      repo <- repoWithSnapshot(emptySnapshot.copy(duePendingCount = 25))
      guard = guardAt(repo, StaticOcrJobQueueHealthCheck(), config)
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertServiceUnavailable(result)
      assertEquals(health, "degraded:outbox_due_backlog_exceeded")

  test("rejects when active outbox backlog exceeds the configured limit"):
    for
      repo <- repoWithSnapshot(emptySnapshot.copy(pendingCount = 49))
      guard = guardAt(repo, StaticOcrJobQueueHealthCheck(), config)
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertServiceUnavailable(result)
      assertEquals(health, "degraded:outbox_active_backlog_exceeded")

  test("rejects when oldest due outbox row is delayed too long"):
    for
      repo <- repoWithSnapshot(
        emptySnapshot
          .copy(duePendingCount = 1, oldestDueNextAttemptAt = Some(now.minusSeconds(601)))
      )
      guard = guardAt(repo, StaticOcrJobQueueHealthCheck(), config)
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertServiceUnavailable(result)
      assertEquals(health, "degraded:outbox_oldest_due_delayed")

  test("rejects when dead-letter backlog exceeds the configured limit"):
    for
      repo <- repoWithSnapshot(emptySnapshot)
      guard = guardAt(repo, StaticOcrJobQueueHealthCheck(deadLetterLengthValue = 25L), config)
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertServiceUnavailable(result)
      assertEquals(health, "degraded:dead_letter_backlog_exceeded")

  private def guardAt(
      repo: RecordingOcrQueueOutboxRepository,
      queueHealth: momo.api.ports.queue.OcrJobQueueHealthCheck[IO],
      config: OcrAdmissionGuard.Config,
  ): OcrAdmissionGuard[IO] =
    given Clock[IO] = FixedClock.at(now)
    OcrAdmissionGuard.from[IO](repo, queueHealth, config)

  private def repoWithSnapshot(
      snapshot: OcrQueueBacklogSnapshot
  ): IO[RecordingOcrQueueOutboxRepository] = RecordingOcrQueueOutboxRepository
    .createWithBacklog(_ => snapshot)

  private def assertServiceUnavailable(result: Either[AppError, Unit]): Unit = result match
    case Left(AppError.ServiceUnavailable(detail)) =>
      assert(detail.contains("OCR queue is temporarily unavailable"))
    case other => fail(s"expected ServiceUnavailable, got: $other")
