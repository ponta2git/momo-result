package momo.api.usecases.ocr

import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.{Clock, IO}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType, StoredImageLocation}
import momo.api.ports.queue.{OcrJobEnqueueRequest, OcrJobQueuePublisher}
import momo.api.repositories.{
  OcrQueueDispatchIntent,
  OcrQueueOutboxRecord,
  OcrQueueOutboxRepository,
  OcrQueueOutboxStatus
}
import momo.api.testing.{
  FailingOcrJobQueuePublisher,
  FixedClock,
  OutboxClaimDueCall,
  OutboxMarkDeliveredCall,
  OutboxNextWakeCall,
  OutboxRearmCall,
  RecordingOcrJobQueuePublisher,
  RecordingOcrQueueOutboxRepository
}
import momo.api.usecases.queue.OutboxDrainResult

final class OcrQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val fixedNow = Instant.parse("2026-05-09T00:00:00Z")
  private val claimToken = UUID.fromString("00000000-0000-0000-0000-000000000001")

  private def rowAt(claimExpiresAt: Instant): OcrQueueOutboxRecord = OcrQueueOutboxRecord(
    id = "outbox-1",
    jobId = OcrJobId.unsafeFromString("job-1"),
    enqueueRequest = OcrJobEnqueueRequest(
      jobId = OcrJobId.unsafeFromString("job-1"),
      draftId = OcrDraftId.unsafeFromString("draft-1"),
      imageId = ImageId.unsafeFromString("image-1"),
      imageLocation = StoredImageLocation.unsafeFromString("source-images/v1/ab/image-1.png"),
      imageSha256 = "ab" * 32,
      imageByteLength = 1L,
      imageMediaType = "image/png",
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = fixedNow,
      hints = OcrJobHints.empty,
      requestId = None,
    ),
    attemptCount = 0,
    claimToken = claimToken,
    claimExpiresAt = claimExpiresAt,
  )

  private def dispatcherAt(
      now: Instant,
      repo: OcrQueueOutboxRepository[IO],
      queue: OcrJobQueuePublisher[IO],
      config: OcrQueueOutboxDispatcherConfig,
  ): OcrQueueOutboxDispatcher[IO] =
    given Clock[IO] = FixedClock.at(now)
    OcrQueueOutboxDispatcher[IO](repo, queue, config)

  test("drainBatch rearms semantics, publishes claimed rows, and records delivery"):
    for
      repo <- RecordingOcrQueueOutboxRepository.createWithSchedule(
        call => List(rowAt(call.claimUntil)),
        markDeliveredResult = true,
        releaseForRetryResult = true,
        rearmResult = 1,
        nextWakeAtResult = None,
      )
      queue <- RecordingOcrJobQueuePublisher.create
      config = OcrQueueOutboxDispatcherConfig(batchSize = 25, claimTtl = 30.seconds)
      result <- dispatcherAt(fixedNow, repo, queue, config).drainBatch
      gotRearms <- repo.rearms
      gotClaims <- repo.claims
      gotDelivered <- repo.deliveries
      wakeups <- repo.nextWakeAts
    yield
      assertEquals(result, OutboxDrainResult.Progress)
      assertEquals(
        gotRearms,
        Vector(OutboxRearmCall(
          fixedNow,
          fixedNow.minusSeconds(120),
          25,
        ))
      )
      assertEquals(
        gotClaims,
        Vector(OutboxClaimDueCall(
          25,
          fixedNow,
          fixedNow.plusSeconds(30),
        ))
      )
      assertEquals(
        gotDelivered,
        Vector(OutboxMarkDeliveredCall("outbox-1", claimToken, "redis-job-1", fixedNow)),
      )
      assertEquals(wakeups, Vector.empty)

  test("idle batch returns the repository's earliest retry or semantic deadline"):
    val nextWakeAt = fixedNow.plusSeconds(45)
    for
      repo <- RecordingOcrQueueOutboxRepository.createWithSchedule(
        _ => Nil,
        markDeliveredResult = true,
        releaseForRetryResult = true,
        rearmResult = 0,
        nextWakeAtResult = Some(nextWakeAt),
      )
      queue <- RecordingOcrJobQueuePublisher.create
      result <- dispatcherAt(fixedNow, repo, queue, OcrQueueOutboxDispatcherConfig()).drainBatch
      wakeups <- repo.nextWakeAts
    yield
      assertEquals(result, OutboxDrainResult.Idle(Some(nextWakeAt)))
      assertEquals(wakeups, Vector(OutboxNextWakeCall(fixedNow, 120.seconds)))

  test("overdue work skipped by a competing claim gets a one-shot contention delay"):
    for
      repo <- RecordingOcrQueueOutboxRepository.createWithSchedule(
        _ => Nil,
        markDeliveredResult = true,
        releaseForRetryResult = true,
        rearmResult = 0,
        nextWakeAtResult = Some(fixedNow.minusSeconds(1)),
      )
      queue <- RecordingOcrJobQueuePublisher.create
      result <- dispatcherAt(fixedNow, repo, queue, OcrQueueOutboxDispatcherConfig()).drainBatch
    yield assertEquals(result, OutboxDrainResult.Idle(Some(fixedNow.plusSeconds(1))))

  test("failed publish is released for a one-second first retry with a safe error class"):
    val queueError = new RuntimeException("redis://secret-host/boom")
    for
      repo <-
        RecordingOcrQueueOutboxRepository.createWithRows(List(rowAt(fixedNow.plusSeconds(30))))
      _ <- dispatcherAt(
        fixedNow,
        repo,
        FailingOcrJobQueuePublisher(queueError),
        OcrQueueOutboxDispatcherConfig(),
      ).drainBatch
      got <- repo.releases
    yield
      assertEquals(
        got.map(call => call.id -> call.lastError),
        Vector("outbox-1" -> classOf[RuntimeException].getName),
      )
      assertEquals(got.map(_.nextAttemptAt), Vector(fixedNow.plusSeconds(1)))

  test("stale claim fencing makes delivery and retry updates harmless"):
    val queueError = new RuntimeException("redis://secret-host/boom")
    for
      deliveredRepo <- RecordingOcrQueueOutboxRepository
        .create(call => List(rowAt(call.claimUntil)), false, true)
      deliveredQueue <- RecordingOcrJobQueuePublisher.create
      _ <- dispatcherAt(
        fixedNow,
        deliveredRepo,
        deliveredQueue,
        OcrQueueOutboxDispatcherConfig(),
      ).drainBatch
      retriedRepo <- RecordingOcrQueueOutboxRepository
        .create(call => List(rowAt(call.claimUntil)), true, false)
      _ <- dispatcherAt(
        fixedNow,
        retriedRepo,
        FailingOcrJobQueuePublisher(queueError),
        OcrQueueOutboxDispatcherConfig(),
      ).drainBatch
      deliveries <- deliveredRepo.deliveries
      releases <- retriedRepo.releases
    yield
      assertEquals(deliveries.map(_.claimToken), Vector(claimToken))
      assertEquals(releases.map(_.claimToken), Vector(claimToken))

  test("outbox status decoding is closed over the persisted wire values"):
    OcrQueueOutboxStatus.values.foreach { status =>
      assertEquals(OcrQueueOutboxStatus.fromWire(status.wire), Some(status))
    }
    assertEquals(OcrQueueOutboxStatus.fromWire("UNKNOWN"), None)

  test("outbox-backed submitter trusts the durable intent without direct claim or publish"):
    for
      repo <-
        RecordingOcrQueueOutboxRepository.createWithRows(List(rowAt(fixedNow.plusSeconds(30))))
      queue <- RecordingOcrJobQueuePublisher.create
      result <- OcrJobQueueSubmitter.outboxBacked[IO](repo, queue).submit(context)
      claims <- repo.claims
      deliveries <- repo.deliveries
      published <- queue.published
    yield
      assertEquals(result, Right(()))
      assertEquals(claims, Vector.empty)
      assertEquals(deliveries, Vector.empty)
      assertEquals(published, Vector.empty)

  private def context: OcrQueueDispatchIntent = OcrQueueDispatchIntent(
    enqueueRequest = rowAt(fixedNow.plusSeconds(30)).enqueueRequest,
    jobId = OcrJobId.unsafeFromString("job-1"),
    draftId = OcrDraftId.unsafeFromString("draft-1"),
    matchDraftId = None,
    createdAt = fixedNow,
  )
