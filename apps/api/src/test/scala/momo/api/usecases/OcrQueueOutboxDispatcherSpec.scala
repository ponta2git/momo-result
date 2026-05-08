package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.*

import cats.Applicative
import cats.effect.{Clock, IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.OcrJobId
import momo.api.repositories.{
  OcrQueueOutboxRecord, OcrQueueOutboxRepository, OcrQueuePayload, QueueProducer,
}

final class OcrQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val fixedNow = Instant.parse("2026-05-09T00:00:00Z")

  private val row = OcrQueueOutboxRecord(
    id = "outbox-1",
    jobId = OcrJobId("job-1"),
    payload = OcrQueuePayload(Map("jobId" -> "job-1")),
    attemptCount = 0,
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
      delivered <- Ref.of[IO, Vector[(String, String, Instant)]](Vector.empty)
      repo = new OcrQueueOutboxRepository[IO]:
        override def claimDue(
            limit: Int,
            now: Instant,
            claimUntil: Instant,
        ): IO[List[OcrQueueOutboxRecord]] = claimed.update(_ :+ (limit, now, claimUntil))
          .as(List(row))
        override def markDelivered(id: String, redisMessageId: String, now: Instant): IO[Unit] =
          delivered.update(_ :+ (id, redisMessageId, now))
        override def releaseForRetry(
            id: String,
            lastError: String,
            nextAttemptAt: Instant,
            now: Instant,
        ): IO[Unit] =
          val _ = (id, lastError, nextAttemptAt, now)
          IO.unit
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
      assertEquals(gotDelivered, Vector(("outbox-1", "redis-job-1", fixedNow)))

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
          IO.pure(List(row))
        override def markDelivered(id: String, redisMessageId: String, now: Instant): IO[Unit] =
          val _ = (id, redisMessageId, now)
          IO.unit
        override def releaseForRetry(
            id: String,
            lastError: String,
            nextAttemptAt: Instant,
            now: Instant,
        ): IO[Unit] =
          val _ = now
          released.update(_ :+ (id, lastError, nextAttemptAt))
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
