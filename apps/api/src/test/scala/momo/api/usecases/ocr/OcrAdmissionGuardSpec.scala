package momo.api.usecases.ocr

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, IO}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.errors.AppError
import momo.api.repositories.OcrJobBacklogSnapshot
import momo.api.testing.FixedClock

final class OcrAdmissionGuardSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val now = Instant.parse("2026-05-19T12:00:00Z")
  private given Clock[IO] = FixedClock.at(now)
  private val config =
    OcrAdmissionGuard.Config(activeJobLimit = 48, oldestReadyMaxDelay = 10.minutes)

  test("allows queued and running work below the active limit and ready-delay boundary"):
    val guard = OcrAdmissionGuard.from[IO](
      _ => IO.pure(OcrJobBacklogSnapshot(40, 7, Some(now.minusSeconds(600)))),
      config,
    )
    for
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assertEquals(result, Right(()))
      assertEquals(health, "ok")

  test("rejects when durable job state cannot be read"):
    checkRejected(
      _ => IO.raiseError(RuntimeException("database unavailable")),
      "job_status_unavailable"
    )

  test("queued and running jobs both count toward the active limit"):
    checkRejected(_ => IO.pure(OcrJobBacklogSnapshot(40, 8, None)), "active_job_limit_reached")

  test("rejects when the oldest ready job is delayed beyond the threshold"):
    checkRejected(
      _ => IO.pure(OcrJobBacklogSnapshot(1, 0, Some(now.minusSeconds(601)))),
      "oldest_ready_job_delayed",
    )

  private def checkRejected(
      snapshot: Instant => IO[OcrJobBacklogSnapshot],
      reason: String
  ): IO[Unit] =
    val guard = OcrAdmissionGuard.from[IO](snapshot, config)
    for
      result <- guard.ensureAvailable
      health <- guard.healthStatus
    yield
      assert(result.left.exists {
        case AppError.ServiceUnavailable(detail) =>
          detail.contains("OCR processing is temporarily unavailable")
        case _ => false
      })
      assertEquals(health, s"degraded:$reason")
