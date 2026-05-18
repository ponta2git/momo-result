package momo.api.usecases

import java.nio.file.Path
import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, IO}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.repositories.{
  OcrQueueOutboxRecord, OcrQueueOutboxRepository, OcrQueuePayload, QueueProducer,
}
import momo.api.testing.{
  FailingQueueProducer, FixedClock, OutboxClaimDueCall, OutboxMarkDeliveredCall,
  RecordingOcrQueueOutboxRepository, RecordingQueueProducer,
}

final class OcrQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val fixedNow = Instant.parse("2026-05-09T00:00:00Z")

  private def rowAt(claimExpiresAt: Instant): OcrQueueOutboxRecord =
    rowAt(claimExpiresAt, "outbox-1")

  private def rowAt(claimExpiresAt: Instant, id: String) = OcrQueueOutboxRecord(
    id = id,
    jobId = OcrJobId.unsafeFromString("job-1"),
    payload = OcrQueuePayload.build(
      jobId = OcrJobId.unsafeFromString("job-1"),
      draftId = OcrDraftId.unsafeFromString("draft-1"),
      imageId = ImageId.unsafeFromString("image-1"),
      imagePath = Path.of("/tmp/image.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = fixedNow,
      hints = OcrJobHints.empty,
      requestId = None,
    ),
    attemptCount = 0,
    claimExpiresAt = claimExpiresAt,
  )

  private def dispatcherAt(
      now: Instant,
      repo: OcrQueueOutboxRepository[IO],
      queue: QueueProducer[IO],
      config: OcrQueueOutboxDispatcherConfig,
  ): OcrQueueOutboxDispatcher[IO] =
    given Clock[IO] = FixedClock.at(now)
    OcrQueueOutboxDispatcher[IO](repo, queue, config)

  test("runOnce publishes claimed rows and marks them delivered"):
    for
      repo <- RecordingOcrQueueOutboxRepository
        .create(call => List(rowAt(call.claimUntil)), true, true)
      queue <- RecordingQueueProducer.create
      config = OcrQueueOutboxDispatcherConfig(batchSize = 25, claimTtl = 30.seconds)
      _ <- dispatcherAt(fixedNow, repo, queue, config).runOnce
      gotClaimed <- repo.claims
      gotDelivered <- repo.deliveries
    yield
      assertEquals(gotClaimed, Vector(OutboxClaimDueCall(25, fixedNow, fixedNow.plusSeconds(30))))
      assertEquals(
        gotDelivered,
        Vector(
          OutboxMarkDeliveredCall("outbox-1", fixedNow.plusSeconds(30), "redis-job-1", fixedNow)
        ),
      )

  test("runOnce releases failed publishes for retry with sanitized error class"):
    val queueError = new RuntimeException("redis://secret-host/boom")
    for
      repo <- RecordingOcrQueueOutboxRepository
        .createWithRows(List(rowAt(fixedNow.plusSeconds(30))))
      queue = FailingQueueProducer(queueError)
      _ <- dispatcherAt(fixedNow, repo, queue, OcrQueueOutboxDispatcherConfig()).runOnce
      got <- repo.releases
    yield
      assertEquals(
        got.map(call => call.id -> call.lastError),
        Vector("outbox-1" -> classOf[RuntimeException].getName),
      )
      assertEquals(got.map(_.nextAttemptAt), Vector(fixedNow.plusSeconds(2)))

  test("outbox-backed submitter claims the created outbox row and marks it delivered"):
    val outboxId = "ocr-outbox-job-1"
    for
      repo <- RecordingOcrQueueOutboxRepository
        .createWithClaimById(call => Some(rowAt(call.claimUntil, outboxId)))
      queue <- RecordingQueueProducer.create
      submitter = withFixedClock:
        OcrQueueSubmitter.outboxBacked[IO](repo, queue)
      result <- submitter.submit(context)
      gotClaims <- repo.claimByIds
      gotDelivered <- repo.deliveries
    yield
      assertEquals(result, Right(()))
      assertEquals(gotClaims.map(_.id), Vector(outboxId))
      assertEquals(
        gotDelivered,
        Vector(OutboxMarkDeliveredCall(outboxId, fixedNow.plusSeconds(30), "redis-job-1", fixedNow)),
      )

  test("outbox-backed submitter keeps the API result successful when immediate publish fails"):
    val queueError = new RuntimeException("redis://secret-host/boom")
    val outboxId = "ocr-outbox-job-1"
    for
      repo <- RecordingOcrQueueOutboxRepository
        .createWithClaimById(call => Some(rowAt(call.claimUntil, outboxId)))
      submitter = withFixedClock:
        OcrQueueSubmitter.outboxBacked[IO](repo, FailingQueueProducer(queueError))
      result <- submitter.submit(context)
      got <- repo.releases
    yield
      assertEquals(result, Right(()))
      assertEquals(
        got.map(call => call.id -> call.lastError),
        Vector(outboxId -> classOf[RuntimeException].getName),
      )
      assertEquals(got.map(_.nextAttemptAt), Vector(fixedNow.plusSeconds(2)))

  private def withFixedClock[A](body: Clock[IO] ?=> A): A =
    given Clock[IO] = FixedClock.at(fixedNow)
    body

  private def context: OcrQueueSubmitter.Context = OcrQueueSubmitter.Context(
    payload = rowAt(fixedNow.plusSeconds(30)).payload,
    jobId = OcrJobId.unsafeFromString("job-1"),
    draftId = OcrDraftId.unsafeFromString("draft-1"),
    matchDraftId = None,
    createdAt = fixedNow,
  )
