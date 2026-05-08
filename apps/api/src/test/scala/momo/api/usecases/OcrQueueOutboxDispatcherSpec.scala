package momo.api.usecases

import java.time.Instant

import cats.effect.{IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.OcrJobId
import momo.api.repositories.{
  OcrQueueOutboxRecord, OcrQueueOutboxRepository, OcrQueuePayload, QueueProducer,
}

final class OcrQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val row = OcrQueueOutboxRecord(
    id = "outbox-1",
    jobId = OcrJobId("job-1"),
    payload = OcrQueuePayload(Map("jobId" -> "job-1")),
    attemptCount = 0,
  )

  test("runOnce publishes claimed rows and marks them delivered"):
    for
      delivered <- Ref.of[IO, Vector[(String, String)]](Vector.empty)
      repo = new OcrQueueOutboxRepository[IO]:
        override def claimDue(
            limit: Int,
            now: Instant,
            claimUntil: Instant,
        ): IO[List[OcrQueueOutboxRecord]] =
          val _ = (limit, now, claimUntil)
          IO.pure(List(row))
        override def markDelivered(id: String, redisMessageId: String, now: Instant): IO[Unit] =
          val _ = now
          delivered.update(_ :+ (id -> redisMessageId))
        override def releaseForRetry(
            id: String,
            lastError: String,
            nextAttemptAt: Instant,
            now: Instant,
        ): IO[Unit] =
          val _ = (id, lastError, nextAttemptAt, now)
          IO.unit
      queue = new QueueProducer[IO]:
        override def publish(payload: OcrQueuePayload): IO[String] =
          IO.pure(s"redis-${payload.fields("jobId")}")
        override def ping: IO[Unit] = IO.unit
      _ <- OcrQueueOutboxDispatcher[IO](repo, queue, OcrQueueOutboxDispatcherConfig()).runOnce
      got <- delivered.get
    yield assertEquals(got, Vector("outbox-1" -> "redis-job-1"))

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
      before <- IO.realTimeInstant
      _ <- OcrQueueOutboxDispatcher[IO](repo, queue, OcrQueueOutboxDispatcherConfig()).runOnce
      got <- released.get
    yield
      assertEquals(got.map { case (id, lastError, _) => id -> lastError }, Vector(
        "outbox-1" -> classOf[RuntimeException].getName
      ))
      assert(got.head._3.isAfter(before), s"nextAttemptAt should be after $before: ${got.head._3}")
