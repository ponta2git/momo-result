package momo.api.domain

import java.nio.file.Paths
import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.InMemoryOcrJobsRepository
import momo.api.domain.ids.*

final class OcrJobLifecycleSpec extends CatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-04T10:00:00Z")
  private val laterAt = Instant.parse("2026-05-04T10:05:00Z")

  private def queued: OcrJob.Queued = OcrJob.Queued(
    id = OcrJobId("job_1"),
    draftId = OcrDraftId("draft_1"),
    imageId = ImageId("img_1"),
    imagePath = Paths.get("/tmp/img_1.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  test("trait Option accessors expose case-specific fields"):
    val q = queued
    assertEquals(q.workerId, None)
    assertEquals(q.failure, None)
    assertEquals(q.finishedAt, None)
    assertEquals(q.status, OcrJobStatus.Queued)

    val r = OcrJob.Running(
      id = q.id,
      draftId = q.draftId,
      imageId = q.imageId,
      imagePath = q.imagePath,
      requestedScreenType = q.requestedScreenType,
      attemptCount = 1,
      runningWorkerId = "w1",
      runningStartedAt = laterAt,
      createdAt = q.createdAt,
      updatedAt = laterAt,
    )
    assertEquals(r.workerId, Some("w1"))
    assertEquals(r.startedAt, Some(laterAt))
    assertEquals(r.status, OcrJobStatus.Running)

  test("InMemoryOcrJobsRepository.cancelQueued only succeeds on Queued"):
    for
      repo <- InMemoryOcrJobsRepository.create[IO]
      _ <- repo.create(queued)
      cancelled1 <- repo.cancelQueued(queued.id, laterAt)
      _ = assert(cancelled1)
      after <- repo.find(queued.id)
      _ = assert(after.exists {
        case _: OcrJob.Cancelled => true
        case _ => false
      })
      cancelled2 <- repo.cancelQueued(queued.id, laterAt)
    yield assert(!cancelled2)

  test("markFailed transitions any non-failed job to OcrJob.Failed preserving fields"):
    val running = OcrJob.Running(
      id = queued.id,
      draftId = queued.draftId,
      imageId = queued.imageId,
      imagePath = queued.imagePath,
      requestedScreenType = queued.requestedScreenType,
      attemptCount = 1,
      runningWorkerId = "w1",
      runningStartedAt = createdAt,
      createdAt = createdAt,
      updatedAt = createdAt,
    )
    val failure = OcrFailure(FailureCode.OcrTimeout, "timeout", retryable = true, None)
    for
      repo <- InMemoryOcrJobsRepository.create[IO]
      _ <- repo.create(running)
      _ <- repo.markFailed(running.id, failure, laterAt)
      after <- repo.find(running.id)
    yield after match
      case Some(f: OcrJob.Failed) =>
        assertEquals(f.failedFailure, failure)
        assertEquals(f.failedWorkerId, Some("w1"))
        assertEquals(f.failedStartedAt, Some(createdAt))
        assertEquals(f.failedFinishedAt, laterAt)
      case other => fail(s"expected OcrJob.Failed, got $other")
end OcrJobLifecycleSpec
