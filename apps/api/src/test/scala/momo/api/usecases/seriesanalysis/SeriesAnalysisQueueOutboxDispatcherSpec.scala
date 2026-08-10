package momo.api.usecases.seriesanalysis

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.ports.queue.SeriesAnalysisQueuePublisher
import momo.api.repositories.{
  SeriesAnalysisCleanupCounts,
  SeriesAnalysisQueueOutboxRecord,
  SeriesAnalysisQueueOutboxRepository
}
import momo.api.testing.FixedClock

final class SeriesAnalysisQueueOutboxDispatcherSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]
  private val now = Instant.parse("2026-08-10T00:00:00Z")
  private val claimUntil = now.plusSeconds(30)
  private val row = SeriesAnalysisQueueOutboxRecord("outbox-1", "job-1", 0, claimUntil)
  private val config = SeriesAnalysisQueueDispatcherConfig(
    batchSize = 25,
    claimTtl = 30.seconds,
    redeliveryAfter = 5.minutes,
  )

  test("runOnce performs maintenance, publishes each claim, and records exact delivery identity"):
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, List(row))
      queue = RecordingPublisher(published, Right("redis-message-1"))
      _ <- dispatcher(repository, queue).runOnce
      actual <- calls.get
      actualPublished <- published.get
    yield
      assertEquals(actual.expansions, Vector(now -> 25))
      assertEquals(actual.reconciliations, Vector((now, now.minusSeconds(300), 25)))
      assertEquals(actual.claims, Vector((25, now, claimUntil)))
      assertEquals(actualPublished, Vector("job-1"))
      assertEquals(
        actual.deliveries,
        Vector(("outbox-1", claimUntil, "redis-message-1", now)),
      )
      assertEquals(actual.releases, Vector.empty)

  test("runOnce releases a failed publish with bounded backoff and a sanitized error class"):
    val failure = new IllegalStateException("redis://secret-host/analysis")
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, List(row))
      queue = RecordingPublisher(published, Left(failure))
      _ <- dispatcher(repository, queue).runOnce
      actual <- calls.get
      actualPublished <- published.get
    yield
      assertEquals(actualPublished, Vector("job-1"))
      assertEquals(actual.deliveries, Vector.empty)
      assertEquals(
        actual.releases,
        Vector((
          "outbox-1",
          claimUntil,
          now.plusSeconds(2),
          classOf[IllegalStateException].getName,
          now,
        )),
      )

  private def dispatcher(
      repository: SeriesAnalysisQueueOutboxRepository[IO],
      queue: SeriesAnalysisQueuePublisher[IO],
  ): SeriesAnalysisQueueOutboxDispatcher[IO] =
    given Clock[IO] = FixedClock.at(now)
    new SeriesAnalysisQueueOutboxDispatcher(repository, queue, config)

  private final case class Calls(
      expansions: Vector[(Instant, Int)],
      reconciliations: Vector[(Instant, Instant, Int)],
      claims: Vector[(Int, Instant, Instant)],
      deliveries: Vector[(String, Instant, String, Instant)],
      releases: Vector[(String, Instant, Instant, String, Instant)],
  )

  private object Calls:
    val empty: Calls = Calls(Vector.empty, Vector.empty, Vector.empty, Vector.empty, Vector.empty)

  private final case class RecordingRepository(
      calls: Ref[IO, Calls],
      rows: List[SeriesAnalysisQueueOutboxRecord],
  ) extends SeriesAnalysisQueueOutboxRepository[IO]:
    override def expandPendingCampaignTargets(now: Instant, limit: Int): IO[Int] = calls
      .update(value => value.copy(expansions = value.expansions :+ (now -> limit))).as(0)

    override def reconcileQueued(now: Instant, redeliverBefore: Instant, limit: Int): IO[Int] =
      calls.update(value =>
        value.copy(
          reconciliations = value.reconciliations :+ ((now, redeliverBefore, limit))
        )
      ).as(0)

    override def claimDue(
        limit: Int,
        now: Instant,
        claimUntil: Instant,
    ): IO[List[SeriesAnalysisQueueOutboxRecord]] = calls
      .update(value => value.copy(claims = value.claims :+ ((limit, now, claimUntil))))
      .as(rows)

    override def markDelivered(
        id: String,
        claimExpiresAt: Instant,
        redisMessageId: String,
        now: Instant,
    ): IO[Boolean] = calls.update(value =>
      value.copy(
        deliveries = value.deliveries :+ ((id, claimExpiresAt, redisMessageId, now))
      )
    ).as(true)

    override def releaseForRetry(
        id: String,
        claimExpiresAt: Instant,
        nextAttemptAt: Instant,
        safeErrorClass: String,
        now: Instant,
    ): IO[Boolean] = calls.update(value =>
      value.copy(
        releases = value.releases :+
          ((
            id,
            claimExpiresAt,
            nextAttemptAt,
            safeErrorClass,
            now,
          ))
      )
    ).as(true)

    override def cleanupHistory(
        terminalBefore: Instant,
        stagingBefore: Instant,
        limitPerTable: Int,
    ): IO[SeriesAnalysisCleanupCounts] =
      val _ = (terminalBefore, stagingBefore, limitPerTable)
      IO.pure(SeriesAnalysisCleanupCounts(0, 0, 0, 0, 0))

  private final case class RecordingPublisher(
      published: Ref[IO, Vector[String]],
      result: Either[Throwable, String],
  ) extends SeriesAnalysisQueuePublisher[IO]:
    override def publish(jobId: String): IO[String] =
      published.update(_ :+ jobId) *> result.fold(IO.raiseError, IO.pure)

end SeriesAnalysisQueueOutboxDispatcherSpec
