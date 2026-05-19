package momo.api.testing

import java.time.Instant

import scala.concurrent.duration.*

import cats.Applicative
import cats.effect.{Clock, IO, Ref}

import momo.api.adapters.RedisStreamClient
import momo.api.auth.{DiscordOAuthClient, DiscordUser}
import momo.api.domain.ids.{AccountId, ImageId, OcrJobId}
import momo.api.domain.{OcrFailure, OcrJob, StoredImage}
import momo.api.errors.AppError
import momo.api.repositories.{
  AppSession, AppSessionsRepository, ImageStore, OcrJobsRepository, OcrQueueOutboxRecord,
  OcrQueueOutboxRepository, OcrQueuePayload, QueueProducer,
}

object FixedClock:
  def at(now: Instant): Clock[IO] = new Clock[IO]:
    override val applicative: Applicative[IO] = Applicative[IO]
    override def monotonic: IO[FiniteDuration] = IO.pure(0.nanos)
    override def realTime: IO[FiniteDuration] = IO
      .pure(java.time.Duration.between(Instant.EPOCH, now).toNanos.nanos)

final class RecordingQueueProducer private (
    ref: Ref[IO, Vector[OcrQueuePayload]],
    messageId: OcrQueuePayload => String,
) extends QueueProducer[IO]:
  override def publish(payload: OcrQueuePayload): IO[String] = ref.update(_ :+ payload)
    .as(messageId(payload))
  override def ping: IO[Unit] = IO.unit

  def published: IO[Vector[OcrQueuePayload]] = ref.get

object RecordingQueueProducer:
  def create: IO[RecordingQueueProducer] =
    createWithMessageId(payload => s"redis-${payload.fields("jobId")}")

  def createWithMessageId(messageId: OcrQueuePayload => String): IO[RecordingQueueProducer] = Ref
    .of[IO, Vector[OcrQueuePayload]](Vector.empty)
    .map(ref => new RecordingQueueProducer(ref, messageId))

final case class FailingQueueProducer(error: Throwable) extends QueueProducer[IO]:
  override def publish(payload: OcrQueuePayload): IO[String] =
    val _ = payload
    IO.raiseError(error)
  override def ping: IO[Unit] = IO.unit

final case class FailingMarkFailedOcrJobsRepository(
    delegate: OcrJobsRepository[IO],
    markFailedError: Throwable,
) extends OcrJobsRepository[IO]:
  override def create(job: OcrJob): IO[Unit] = delegate.create(job)
  override def find(jobId: OcrJobId): IO[Option[OcrJob]] = delegate.find(jobId)
  override def countActive: IO[Long] = delegate.countActive
  override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): IO[Unit] =
    val _ = (jobId, failure, now)
    IO.raiseError(markFailedError)
  override def cancelQueued(jobId: OcrJobId, now: Instant): IO[Boolean] = delegate
    .cancelQueued(jobId, now)

final case class FailingDeleteImageStore(delegate: ImageStore[IO], deleteError: Throwable)
    extends ImageStore[IO]:
  override def save(
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): IO[Either[AppError, StoredImage]] = delegate.save(fileName, contentType, bytes)
  override def find(imageId: ImageId): IO[Option[StoredImage]] = delegate.find(imageId)
  override def readBytes(image: StoredImage): IO[Array[Byte]] = delegate.readBytes(image)
  override def delete(imageId: ImageId): IO[Boolean] =
    val _ = imageId
    IO.raiseError(deleteError)

final case class OutboxClaimDueCall(limit: Int, now: Instant, claimUntil: Instant) derives CanEqual
final case class OutboxClaimByIdCall(id: String, now: Instant, claimUntil: Instant) derives CanEqual

final case class OutboxMarkDeliveredCall(
    id: String,
    claimExpiresAt: Instant,
    redisMessageId: String,
    now: Instant,
) derives CanEqual

final case class OutboxReleaseForRetryCall(
    id: String,
    claimExpiresAt: Instant,
    lastError: String,
    nextAttemptAt: Instant,
    now: Instant,
) derives CanEqual

final class RecordingOcrQueueOutboxRepository private (
    claimRows: OutboxClaimDueCall => List[OcrQueueOutboxRecord],
    claimByIdRows: OutboxClaimByIdCall => Option[OcrQueueOutboxRecord],
    markDeliveredResult: Boolean,
    releaseForRetryResult: Boolean,
    claimsRef: Ref[IO, Vector[OutboxClaimDueCall]],
    claimByIdsRef: Ref[IO, Vector[OutboxClaimByIdCall]],
    deliveriesRef: Ref[IO, Vector[OutboxMarkDeliveredCall]],
    releasesRef: Ref[IO, Vector[OutboxReleaseForRetryCall]],
) extends OcrQueueOutboxRepository[IO]:
  override def claimById(
      id: String,
      now: Instant,
      claimUntil: Instant,
  ): IO[Option[OcrQueueOutboxRecord]] =
    val call = OutboxClaimByIdCall(id, now, claimUntil)
    claimByIdsRef.update(_ :+ call).as(claimByIdRows(call))

  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): IO[List[OcrQueueOutboxRecord]] =
    val call = OutboxClaimDueCall(limit, now, claimUntil)
    claimsRef.update(_ :+ call).as(claimRows(call))

  override def markDelivered(
      id: String,
      claimExpiresAt: Instant,
      redisMessageId: String,
      now: Instant,
  ): IO[Boolean] = deliveriesRef
    .update(_ :+ OutboxMarkDeliveredCall(id, claimExpiresAt, redisMessageId, now))
    .as(markDeliveredResult)

  override def releaseForRetry(
      id: String,
      claimExpiresAt: Instant,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): IO[Boolean] = releasesRef
    .update(_ :+ OutboxReleaseForRetryCall(id, claimExpiresAt, lastError, nextAttemptAt, now))
    .as(releaseForRetryResult)

  def claims: IO[Vector[OutboxClaimDueCall]] = claimsRef.get
  def claimByIds: IO[Vector[OutboxClaimByIdCall]] = claimByIdsRef.get
  def deliveries: IO[Vector[OutboxMarkDeliveredCall]] = deliveriesRef.get
  def releases: IO[Vector[OutboxReleaseForRetryCall]] = releasesRef.get

object RecordingOcrQueueOutboxRepository:
  def createWithRows(rows: List[OcrQueueOutboxRecord]): IO[RecordingOcrQueueOutboxRepository] =
    create(_ => rows, markDeliveredResult = true, releaseForRetryResult = true)

  def createWithClaimById(
      row: OutboxClaimByIdCall => Option[OcrQueueOutboxRecord]
  ): IO[RecordingOcrQueueOutboxRepository] =
    create(_ => Nil, row, markDeliveredResult = true, releaseForRetryResult = true)

  def create(
      claimRows: OutboxClaimDueCall => List[OcrQueueOutboxRecord],
      markDeliveredResult: Boolean,
      releaseForRetryResult: Boolean,
  ): IO[RecordingOcrQueueOutboxRepository] =
    create(claimRows, _ => None, markDeliveredResult, releaseForRetryResult)

  def create(
      claimRows: OutboxClaimDueCall => List[OcrQueueOutboxRecord],
      claimByIdRows: OutboxClaimByIdCall => Option[OcrQueueOutboxRecord],
      markDeliveredResult: Boolean,
      releaseForRetryResult: Boolean,
  ): IO[RecordingOcrQueueOutboxRepository] =
    for
      claims <- Ref.of[IO, Vector[OutboxClaimDueCall]](Vector.empty)
      claimByIds <- Ref.of[IO, Vector[OutboxClaimByIdCall]](Vector.empty)
      deliveries <- Ref.of[IO, Vector[OutboxMarkDeliveredCall]](Vector.empty)
      releases <- Ref.of[IO, Vector[OutboxReleaseForRetryCall]](Vector.empty)
    yield new RecordingOcrQueueOutboxRepository(
      claimRows,
      claimByIdRows,
      markDeliveredResult,
      releaseForRetryResult,
      claims,
      claimByIds,
      deliveries,
      releases,
    )

final case class RedisXAddCall(stream: String, fields: Map[String, String]) derives CanEqual

final class RecordingRedisStreamClient private (ref: Ref[IO, Vector[RedisXAddCall]])
    extends RedisStreamClient[IO]:
  override def xadd(stream: String, fields: Map[String, String]): IO[String] = ref
    .update(_ :+ RedisXAddCall(stream, fields)).as("1-0")
  override def ping: IO[Unit] = IO.unit

  def calls: IO[Vector[RedisXAddCall]] = ref.get

object RecordingRedisStreamClient:
  def create: IO[RecordingRedisStreamClient] = Ref.of[IO, Vector[RedisXAddCall]](Vector.empty)
    .map(new RecordingRedisStreamClient(_))

final case class SuccessfulDiscordOAuthClient(userId: String) extends DiscordOAuthClient[IO]:
  override def authorizationUrl(state: String, prompt: Option[String]): IO[String] =
    val _ = prompt
    IO.pure(s"https://discord.example/oauth?state=$state")
  override def fetchUser(code: String): IO[Either[AppError, DiscordUser]] =
    val _ = code
    IO.pure(Right(DiscordUser(userId)))

final case class AppSessionsSnapshot(
    sessions: Map[String, AppSession],
    renews: Int,
    deletes: List[String],
) derives CanEqual

final class RecordingAppSessionsRepository private (ref: Ref[IO, AppSessionsSnapshot])
    extends AppSessionsRepository[IO]:
  def snapshot: IO[AppSessionsSnapshot] = ref.get

  override def find(idHash: String): IO[Option[AppSession]] = ref.get.map(_.sessions.get(idHash))

  override def upsert(session: AppSession): IO[Unit] = ref
    .update(s => s.copy(sessions = s.sessions.updated(session.idHash, session)))

  override def delete(idHash: String): IO[Unit] = ref
    .update(s => s.copy(sessions = s.sessions - idHash, deletes = idHash :: s.deletes))

  override def deleteByAccount(accountId: AccountId): IO[Int] = ref.modify { s =>
    val retained = s.sessions.filter { case (_, session) => session.accountId != accountId }
    (s.copy(sessions = retained), s.sessions.size - retained.size)
  }

  override def renew(idHash: String, lastSeenAt: Instant, expiresAt: Instant): IO[Unit] = ref
    .update { s =>
      s.copy(
        sessions = s.sessions
          .updatedWith(idHash)(_.map(_.copy(lastSeenAt = lastSeenAt, expiresAt = expiresAt))),
        renews = s.renews + 1,
      )
    }

  override def deleteExpired(now: Instant): IO[Int] = ref.modify { s =>
    val retained = s.sessions.filter { case (_, session) => !session.expiresAt.isBefore(now) }
    (s.copy(sessions = retained), s.sessions.size - retained.size)
  }

object RecordingAppSessionsRepository:
  def create: IO[RecordingAppSessionsRepository] = Ref
    .of[IO, AppSessionsSnapshot](AppSessionsSnapshot(Map.empty, 0, Nil))
    .map(new RecordingAppSessionsRepository(_))
