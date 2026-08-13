package momo.api.domain
import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.inmemory.InMemoryOcrJobsRepository
import momo.api.domain.ids.*

final class OcrJobLifecycleSpec extends CatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-04T10:00:00Z")
  private val laterAt = Instant.parse("2026-05-04T10:05:00Z")

  private final case class AccessorContract(
      job: OcrJob,
      status: OcrJobStatus,
      detectedScreenType: Option[ScreenType] = None,
      workerId: Option[String] = None,
      failure: Option[OcrFailure] = None,
      startedAt: Option[Instant] = None,
      finishedAt: Option[Instant] = None,
      durationMs: Option[Int] = None,
  )

  private def queued: OcrJob.Queued = OcrJob.Queued(
    id = OcrJobId.unsafeFromString("job_1"),
    draftId = OcrDraftId.unsafeFromString("draft_1"),
    imageId = ImageId.unsafeFromString("img_1"),
    imageLocation = StoredImageLocation.unsafeFromString("/tmp/img_1.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  test("status and companion accessors cover every OcrJob lifecycle case"):
    val q = queued
    val r = OcrJob.Running(
      id = q.id,
      draftId = q.draftId,
      imageId = q.imageId,
      imageLocation = q.imageLocation,
      requestedScreenType = q.requestedScreenType,
      attemptCount = 1,
      runningWorkerId = "w1",
      runningStartedAt = laterAt,
      createdAt = q.createdAt,
      updatedAt = laterAt,
    )
    val s = OcrJob.Succeeded(
      id = q.id,
      draftId = q.draftId,
      imageId = q.imageId,
      imageLocation = q.imageLocation,
      requestedScreenType = q.requestedScreenType,
      succeededDetectedScreenType = ScreenType.Revenue,
      attemptCount = 1,
      succeededWorkerId = Some("w2"),
      succeededStartedAt = createdAt,
      succeededFinishedAt = laterAt,
      succeededDurationMs = 300000,
      createdAt = q.createdAt,
      updatedAt = laterAt,
    )
    val failure = OcrFailure(FailureCode.OcrTimeout, "timeout", retryable = true, None)
    val f = OcrJob.Failed(
      id = q.id,
      draftId = q.draftId,
      imageId = q.imageId,
      imageLocation = q.imageLocation,
      requestedScreenType = q.requestedScreenType,
      failedDetectedScreenType = Some(ScreenType.IncidentLog),
      attemptCount = 2,
      failedWorkerId = Some("w3"),
      failedFailure = failure,
      failedStartedAt = Some(createdAt),
      failedFinishedAt = laterAt,
      failedDurationMs = Some(300000),
      createdAt = q.createdAt,
      updatedAt = laterAt,
    )
    val c = OcrJob.Cancelled(
      id = q.id,
      draftId = q.draftId,
      imageId = q.imageId,
      imageLocation = q.imageLocation,
      requestedScreenType = q.requestedScreenType,
      attemptCount = q.attemptCount,
      cancelledFinishedAt = laterAt,
      createdAt = q.createdAt,
      updatedAt = laterAt,
    )
    val contracts = List(
      AccessorContract(q, OcrJobStatus.Queued),
      AccessorContract(
        r,
        OcrJobStatus.Running,
        workerId = Some("w1"),
        startedAt = Some(laterAt),
      ),
      AccessorContract(
        s,
        OcrJobStatus.Succeeded,
        detectedScreenType = Some(ScreenType.Revenue),
        workerId = Some("w2"),
        startedAt = Some(createdAt),
        finishedAt = Some(laterAt),
        durationMs = Some(300000),
      ),
      AccessorContract(
        f,
        OcrJobStatus.Failed,
        detectedScreenType = Some(ScreenType.IncidentLog),
        workerId = Some("w3"),
        failure = Some(failure),
        startedAt = Some(createdAt),
        finishedAt = Some(laterAt),
        durationMs = Some(300000),
      ),
      AccessorContract(
        c,
        OcrJobStatus.Cancelled,
        finishedAt = Some(laterAt),
      ),
    )

    assertEquals(contracts.map(_.status), OcrJobStatus.values.toList)
    contracts.foreach { contract =>
      val clue = s"status=${contract.status.wire}"
      assertEquals(contract.job.status, contract.status, clue)
      assertEquals(OcrJob.detectedScreenType(contract.job), contract.detectedScreenType, clue)
      assertEquals(OcrJob.workerId(contract.job), contract.workerId, clue)
      assertEquals(OcrJob.failure(contract.job), contract.failure, clue)
      assertEquals(OcrJob.startedAt(contract.job), contract.startedAt, clue)
      assertEquals(OcrJob.finishedAt(contract.job), contract.finishedAt, clue)
      assertEquals(OcrJob.durationMs(contract.job), contract.durationMs, clue)
    }

  test("InMemoryOcrJobsRepository.cancelQueued only succeeds on Queued"):
    for
      repo <- InMemoryOcrJobsRepository.create[IO]
      _ <- repo.create(queued)
      cancelled1 <- repo.cancelQueued(queued.id, laterAt)
      _ = assert(cancelled1)
      after <- repo.find(queued.id)
      _ = assertEquals(
        after,
        Some(OcrJob.Cancelled(
          id = queued.id,
          draftId = queued.draftId,
          imageId = queued.imageId,
          imageLocation = queued.imageLocation,
          requestedScreenType = queued.requestedScreenType,
          attemptCount = queued.attemptCount,
          cancelledFinishedAt = laterAt,
          createdAt = queued.createdAt,
          updatedAt = laterAt,
        )),
      )
      cancelled2 <- repo.cancelQueued(queued.id, laterAt)
    yield assert(!cancelled2)

  test("markFailed transitions any non-failed job to OcrJob.Failed preserving fields"):
    val running = OcrJob.Running(
      id = queued.id,
      draftId = queued.draftId,
      imageId = queued.imageId,
      imageLocation = queued.imageLocation,
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
