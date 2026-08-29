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
import momo.api.usecases.queue.OutboxDrainResult

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

  test("drainBatch performs maintenance, publishes each claim, and records exact identity"):
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, List(row), None)
      queue = RecordingPublisher(published, Right("redis-message-1"))
      result <- dispatcher(repository, queue).drainBatch
      actual <- calls.get
      actualPublished <- published.get
    yield
      assertEquals(result, OutboxDrainResult.Progress)
      assertEquals(actual.expansions, Vector(now -> 25))
      assertEquals(actual.reconciliations, Vector((now, now.minusSeconds(300), 25)))
      assertEquals(actual.claims, Vector((25, now, claimUntil)))
      assertEquals(actualPublished, Vector("job-1"))
      assertEquals(
        actual.deliveries,
        Vector(("outbox-1", claimUntil, "redis-message-1", now)),
      )
      assertEquals(actual.releases, Vector.empty)
      assertEquals(actual.nextWakeAts, Vector.empty)

  test("idle batch returns the repository's earliest one-shot deadline"):
    val nextWakeAt = now.plusSeconds(90)
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, Nil, Some(nextWakeAt))
      queue = RecordingPublisher(published, Right("unused"))
      result <- dispatcher(repository, queue).drainBatch
      actual <- calls.get
    yield
      assertEquals(result, OutboxDrainResult.Idle(Some(nextWakeAt)))
      assertEquals(actual.nextWakeAts, Vector(now -> 5.minutes))

  test("overdue work skipped by a competing claim gets a one-shot contention delay"):
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, Nil, Some(now.minusSeconds(1)))
      queue = RecordingPublisher(published, Right("unused"))
      result <- dispatcher(repository, queue).drainBatch
    yield assertEquals(result, OutboxDrainResult.Idle(Some(now.plusSeconds(1))))

  test("failed publishes use the fixed two, four, and eight second retry schedule"):
    val failure = new IllegalStateException("redis://secret-host/analysis")
    val retryRows = List(
      SeriesAnalysisQueueOutboxRecord("outbox-1", "job-1", 0, claimUntil),
      SeriesAnalysisQueueOutboxRecord("outbox-2", "job-2", 1, claimUntil),
      SeriesAnalysisQueueOutboxRecord("outbox-3", "job-3", 2, claimUntil),
    )
    for
      calls <- Ref.of[IO, Calls](Calls.empty)
      published <- Ref.of[IO, Vector[String]](Vector.empty)
      repository = RecordingRepository(calls, retryRows, None)
      queue = RecordingPublisher(published, Left(failure))
      _ <- dispatcher(repository, queue).drainBatch
      actual <- calls.get
      actualPublished <- published.get
    yield
      assertEquals(actualPublished, Vector("job-1", "job-2", "job-3"))
      assertEquals(actual.deliveries, Vector.empty)
      assertEquals(
        actual.releases,
        Vector(
          (retryRows(0), now.plusSeconds(2), now.minusSeconds(300), now),
          (retryRows(1), now.plusSeconds(4), now.minusSeconds(300), now),
          (retryRows(2), now.plusSeconds(8), now.minusSeconds(300), now),
        ),
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
      releases: Vector[(SeriesAnalysisQueueOutboxRecord, Instant, Instant, Instant)],
      nextWakeAts: Vector[(Instant, FiniteDuration)],
  )

  private object Calls:
    val empty: Calls = Calls(
      Vector.empty,
      Vector.empty,
      Vector.empty,
      Vector.empty,
      Vector.empty,
      Vector.empty,
    )

  private final case class RecordingRepository(
      calls: Ref[IO, Calls],
      rows: List[SeriesAnalysisQueueOutboxRecord],
      nextWakeAtResult: Option[Instant],
  ) extends SeriesAnalysisQueueOutboxRepository[IO]:
    override def expandPendingCampaignTargets(now: Instant, limit: Int): IO[Int] = calls
      .update(value => value.copy(expansions = value.expansions :+ (now -> limit))).as(0)

    override def reconcileQueued(now: Instant, redeliverBefore: Instant, limit: Int): IO[Int] =
      calls.update(value =>
        value.copy(reconciliations = value.reconciliations :+ ((now, redeliverBefore, limit)))
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
      value.copy(deliveries = value.deliveries :+ ((id, claimExpiresAt, redisMessageId, now)))
    ).as(true)

    override def releaseForRetry(
        claim: SeriesAnalysisQueueOutboxRecord,
        nextAttemptAt: Instant,
        redeliverBefore: Instant,
        now: Instant,
    ): IO[Boolean] = calls.update(value =>
      value.copy(
        releases = value.releases :+ ((claim, nextAttemptAt, redeliverBefore, now))
      )
    ).as(true)

    override def nextWakeAt(
        now: Instant,
        redeliveryAfter: FiniteDuration,
    ): IO[Option[Instant]] = calls
      .update(value => value.copy(nextWakeAts = value.nextWakeAts :+ (now -> redeliveryAfter)))
      .as(nextWakeAtResult)

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
