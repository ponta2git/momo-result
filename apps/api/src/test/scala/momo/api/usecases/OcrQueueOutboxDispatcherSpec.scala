package momo.api.usecases

import java.nio.file.Path
import java.time.Instant

import scala.concurrent.duration.*

import cats.Applicative
import cats.effect.{Clock, IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.repositories.{
  OcrQueueOutboxRecord, OcrQueueOutboxRepository, OcrQueuePayload, QueueProducer,
}

final class OcrQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val fixedNow = Instant.parse("2026-05-09T00:00:00Z")

  private def rowAt(claimExpiresAt: Instant) = OcrQueueOutboxRecord(
    id = "outbox-1",
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

  private def fixedClock(now: Instant): Clock[IO] = new Clock[IO]:
    override val applicative: Applicative[IO] = Applicative[IO]
    override def monotonic: IO[FiniteDuration] = IO.pure(0.nanos)
    override def realTime: IO[FiniteDuration] = IO
      .pure(java.time.Duration.between(Instant.EPOCH, now).toNanos.nanos)

  private def dispatcherAt(
      now: Instant,
      repo: OcrQueueOutboxRepository[IO],
      queue: QueueProducer[IO],
      config: OcrQueueOutboxDispatcherConfig,
  ): OcrQueueOutboxDispatcher[IO] =
    given Clock[IO] = fixedClock(now)
    OcrQueueOutboxDispatcher[IO](repo, queue, config)

  test("runOnce publishes claimed rows and marks them delivered"):
    for
      claimed <- Ref.of[IO, Vector[(Int, Instant, Instant)]](Vector.empty)
      delivered <- Ref.of[IO, Vector[(String, Instant, String, Instant)]](Vector.empty)
      repo = new OcrQueueOutboxRepository[IO]:
        override def claimDue(
            limit: Int,
            now: Instant,
            claimUntil: Instant,
        ): IO[List[OcrQueueOutboxRecord]] = claimed.update(_ :+ (limit, now, claimUntil))
          .as(List(rowAt(claimUntil)))
        override def markDelivered(
            id: String,
            claimExpiresAt: Instant,
            redisMessageId: String,
            now: Instant,
        ): IO[Boolean] = delivered.update(_ :+ (id, claimExpiresAt, redisMessageId, now)).as(true)
        override def releaseForRetry(
            id: String,
            claimExpiresAt: Instant,
            lastError: String,
            nextAttemptAt: Instant,
            now: Instant,
        ): IO[Boolean] =
          val _ = (id, claimExpiresAt, lastError, nextAttemptAt, now)
          IO.pure(true)
      queue = new QueueProducer[IO]:
        override def publish(payload: OcrQueuePayload): IO[String] = IO
          .pure(s"redis-${payload.fields("jobId")}")
        override def ping: IO[Unit] = IO.unit
      config = OcrQueueOutboxDispatcherConfig(batchSize = 25, claimTtl = 30.seconds)
      _ <- dispatcherAt(fixedNow, repo, queue, config).runOnce
      gotClaimed <- claimed.get
      gotDelivered <- delivered.get
    yield
      assertEquals(gotClaimed, Vector((25, fixedNow, fixedNow.plusSeconds(30))))
      assertEquals(
        gotDelivered,
        Vector(("outbox-1", fixedNow.plusSeconds(30), "redis-job-1", fixedNow)),
      )

  test("runOnce releases failed publishes for retry with sanitized error class"):
    val queueError = new RuntimeException("redis://secret-host/boom")
    for
      released <- Ref.of[IO, Vector[(String, String, Instant)]](Vector.empty)
      repo = new OcrQueueOutboxRepository[IO]:
        override def claimDue(
            limit: Int,
            now: Instant,
            claimUntil: Instant,
        ): IO[List[OcrQueueOutboxRecord]] =
          val _ = (limit, now, claimUntil)
          IO.pure(List(rowAt(fixedNow.plusSeconds(30))))
        override def markDelivered(
            id: String,
            claimExpiresAt: Instant,
            redisMessageId: String,
            now: Instant,
        ): IO[Boolean] =
          val _ = (id, claimExpiresAt, redisMessageId, now)
          IO.pure(true)
        override def releaseForRetry(
            id: String,
            claimExpiresAt: Instant,
            lastError: String,
            nextAttemptAt: Instant,
            now: Instant,
        ): IO[Boolean] =
          val _ = (claimExpiresAt, now)
          released.update(_ :+ (id, lastError, nextAttemptAt)).as(true)
      queue = new QueueProducer[IO]:
        override def publish(payload: OcrQueuePayload): IO[String] =
          val _ = payload
          IO.raiseError(queueError)
        override def ping: IO[Unit] = IO.unit
      _ <- dispatcherAt(fixedNow, repo, queue, OcrQueueOutboxDispatcherConfig()).runOnce
      got <- released.get
    yield
      assertEquals(
        got.map { case (id, lastError, _) => id -> lastError },
        Vector("outbox-1" -> classOf[RuntimeException].getName),
      )
      assertEquals(got.map(_._3), Vector(fixedNow.plusSeconds(2)))
