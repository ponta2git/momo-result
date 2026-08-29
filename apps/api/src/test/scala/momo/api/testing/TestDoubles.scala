package momo.api.testing
import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.*

import cats.Applicative
import cats.effect.{Clock, IO, Ref}
import fs2.Stream

import momo.api.auth.{DiscordOAuthClient, DiscordUser}
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.domain.{StoredImage, StoredImageLocation}
import momo.api.errors.AppError
import momo.api.ports.queue.{OcrJobEnqueueRequest, OcrJobQueueHealthCheck, OcrJobQueuePublisher}
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.{
  AppSession,
  AppSessionsRepository,
  InvalidOcrQueueOutboxClaim,
  OcrQueueBacklogSnapshot,
  OcrQueueOutboxClaim,
  OcrQueueOutboxRecord,
  OcrQueueOutboxRepository
}

object FixedClock:
  def at(now: Instant): Clock[IO] = new Clock[IO]:
    override val applicative: Applicative[IO] = Applicative[IO]
    override def monotonic: IO[FiniteDuration] = IO.pure(0.nanos)
    override def realTime: IO[FiniteDuration] = IO
      .pure(java.time.Duration.between(Instant.EPOCH, now).toNanos.nanos)

final class RecordingOcrJobQueuePublisher private (
    ref: Ref[IO, Vector[OcrJobEnqueueRequest]],
    messageId: OcrJobEnqueueRequest => String,
) extends OcrJobQueuePublisher[IO]:
  override def publish(request: OcrJobEnqueueRequest): IO[String] = ref.update(_ :+ request)
    .as(messageId(request))

  def published: IO[Vector[OcrJobEnqueueRequest]] = ref.get

object RecordingOcrJobQueuePublisher:
  def create: IO[RecordingOcrJobQueuePublisher] =
    createWithMessageId(request => s"redis-${request.jobId.value}")

  def createWithMessageId(
      messageId: OcrJobEnqueueRequest => String
  ): IO[RecordingOcrJobQueuePublisher] = Ref
    .of[IO, Vector[OcrJobEnqueueRequest]](Vector.empty)
    .map(ref => new RecordingOcrJobQueuePublisher(ref, messageId))

final case class FailingOcrJobQueuePublisher(error: Throwable) extends OcrJobQueuePublisher[IO]:
  override def publish(request: OcrJobEnqueueRequest): IO[String] =
    val _ = request
    IO.raiseError(error)

final case class FailingDeleteImageStore(delegate: ImageStorage[IO], deleteError: Throwable)
    extends ImageStorage[IO]:
  override def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): IO[Either[AppError, StoredImage]] = delegate.save(ownerAccountId, fileName, contentType, bytes)
  override def find(imageId: ImageId): IO[Option[StoredImage]] = delegate.find(imageId)
  override def readStream(image: StoredImage): Stream[IO, Byte] = delegate.readStream(image)
  override def delete(imageId: ImageId): IO[Boolean] =
    val _ = imageId
    IO.raiseError(deleteError)

final case class NoReadImageStore(image: StoredImage) extends ImageStorage[IO]:
  override def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): IO[Either[AppError, StoredImage]] = failIfCalled("save")
  override def find(imageId: ImageId): IO[Option[StoredImage]] = IO
    .pure(Option.when(imageId == image.imageId)(image))
  override def readStream(image: StoredImage): Stream[IO, Byte] = Stream
    .eval(failIfCalled("readStream"))
  override def delete(imageId: ImageId): IO[Boolean] = failIfCalled("delete")

  private def failIfCalled[A](method: String): IO[A] = IO
    .raiseError(new AssertionError(s"$method should not be called"))

object NoReadImageStore:
  def storedPng(imageId: ImageId, sizeBytes: Long): StoredImage = StoredImage(
    imageId = imageId,
    location = StoredImageLocation.unsafeFromString("/tmp/not-read-source-image.png"),
    mediaType = "image/png",
    sizeBytes = sizeBytes,
    sha256 = "ab" * 32,
  )

final case class OutboxClaimDueCall(limit: Int, now: Instant, claimUntil: Instant) derives CanEqual
final case class OutboxRearmCall(now: Instant, redeliverBefore: Instant, limit: Int)
    derives CanEqual
final case class OutboxNextWakeCall(now: Instant, redeliveryAfter: FiniteDuration) derives CanEqual
final case class OutboxFailInvalidClaimCall(claim: InvalidOcrQueueOutboxClaim, now: Instant)
    derives CanEqual

final case class OutboxMarkDeliveredCall(
    id: String,
    claimToken: UUID,
    redisMessageId: String,
    now: Instant,
) derives CanEqual

final case class OutboxReleaseForRetryCall(
    id: String,
    claimToken: UUID,
    lastError: String,
    nextAttemptAt: Instant,
    now: Instant,
) derives CanEqual

final class RecordingOcrQueueOutboxRepository private (
    claimRows: OutboxClaimDueCall => List[OcrQueueOutboxClaim],
    backlogSnapshotRows: Instant => OcrQueueBacklogSnapshot,
    rearmResult: Int,
    nextWakeAtResult: Option[Instant],
    failInvalidClaimResult: Boolean,
    markDeliveredResult: Boolean,
    releaseForRetryResult: Boolean,
    claimsRef: Ref[IO, Vector[OutboxClaimDueCall]],
    rearmsRef: Ref[IO, Vector[OutboxRearmCall]],
    nextWakeAtsRef: Ref[IO, Vector[OutboxNextWakeCall]],
    invalidFailuresRef: Ref[IO, Vector[OutboxFailInvalidClaimCall]],
    deliveriesRef: Ref[IO, Vector[OutboxMarkDeliveredCall]],
    releasesRef: Ref[IO, Vector[OutboxReleaseForRetryCall]],
) extends OcrQueueOutboxRepository[IO]:
  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): IO[List[OcrQueueOutboxClaim]] =
    val call = OutboxClaimDueCall(limit, now, claimUntil)
    claimsRef.update(_ :+ call).as(claimRows(call))

  override def failInvalidClaim(
      claim: InvalidOcrQueueOutboxClaim,
      now: Instant,
  ): IO[Boolean] = invalidFailuresRef
    .update(_ :+ OutboxFailInvalidClaimCall(claim, now)).as(failInvalidClaimResult)

  override def rearmQueuedForRedelivery(
      now: Instant,
      redeliverBefore: Instant,
      limit: Int,
  ): IO[Int] = rearmsRef.update(_ :+ OutboxRearmCall(now, redeliverBefore, limit)).as(rearmResult)

  override def nextWakeAt(
      now: Instant,
      redeliveryAfter: FiniteDuration,
  ): IO[Option[Instant]] = nextWakeAtsRef
    .update(_ :+ OutboxNextWakeCall(now, redeliveryAfter)).as(nextWakeAtResult)

  override def backlogSnapshot(now: Instant): IO[OcrQueueBacklogSnapshot] = IO
    .pure(backlogSnapshotRows(now))

  override def markDelivered(
      id: String,
      claimToken: UUID,
      redisMessageId: String,
      now: Instant,
  ): IO[Boolean] = deliveriesRef
    .update(_ :+ OutboxMarkDeliveredCall(id, claimToken, redisMessageId, now))
    .as(markDeliveredResult)

  override def releaseForRetry(
      id: String,
      claimToken: UUID,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): IO[Boolean] = releasesRef
    .update(_ :+ OutboxReleaseForRetryCall(id, claimToken, lastError, nextAttemptAt, now))
    .as(releaseForRetryResult)

  def claims: IO[Vector[OutboxClaimDueCall]] = claimsRef.get
  def rearms: IO[Vector[OutboxRearmCall]] = rearmsRef.get
  def nextWakeAts: IO[Vector[OutboxNextWakeCall]] = nextWakeAtsRef.get
  def invalidFailures: IO[Vector[OutboxFailInvalidClaimCall]] = invalidFailuresRef.get
  def deliveries: IO[Vector[OutboxMarkDeliveredCall]] = deliveriesRef.get
  def releases: IO[Vector[OutboxReleaseForRetryCall]] = releasesRef.get

object RecordingOcrQueueOutboxRepository:
  private val emptyBacklog = OcrQueueBacklogSnapshot(
    pendingCount = 0,
    inFlightCount = 0,
    expiredInFlightCount = 0,
    duePendingCount = 0,
    oldestDueNextAttemptAt = None,
    recoverableInvalidCount = 0,
  )

  def createWithRows(rows: List[OcrQueueOutboxRecord]): IO[RecordingOcrQueueOutboxRepository] =
    create(_ => rows, markDeliveredResult = true, releaseForRetryResult = true)

  def createWithClaims(
      claims: List[OcrQueueOutboxClaim]
  ): IO[RecordingOcrQueueOutboxRepository] = createWithClaims(claims, failInvalidClaimResult = true)

  def createWithClaims(
      claims: List[OcrQueueOutboxClaim],
      failInvalidClaimResult: Boolean,
  ): IO[RecordingOcrQueueOutboxRepository] = createWithClaimScheduleAndBacklog(
    _ => claims,
    markDeliveredResult = true,
    releaseForRetryResult = true,
    backlogSnapshotRows = _ => emptyBacklog,
    rearmResult = 0,
    nextWakeAtResult = None,
    failInvalidClaimResult = failInvalidClaimResult,
  )

  def create(
      claimRows: OutboxClaimDueCall => List[OcrQueueOutboxRecord],
      markDeliveredResult: Boolean,
      releaseForRetryResult: Boolean,
  ): IO[RecordingOcrQueueOutboxRepository] = createWithClaimScheduleAndBacklog(
    call => claimRows(call).map(OcrQueueOutboxClaim.Publish.apply),
    markDeliveredResult,
    releaseForRetryResult,
    _ => emptyBacklog,
    rearmResult = 0,
    nextWakeAtResult = None,
    failInvalidClaimResult = true,
  )

  def createWithBacklog(
      rows: Instant => OcrQueueBacklogSnapshot
  ): IO[RecordingOcrQueueOutboxRepository] = createWithClaimScheduleAndBacklog(
    _ => Nil,
    markDeliveredResult = true,
    releaseForRetryResult = true,
    backlogSnapshotRows = rows,
    rearmResult = 0,
    nextWakeAtResult = None,
    failInvalidClaimResult = true,
  )

  def createWithSchedule(
      claimRows: OutboxClaimDueCall => List[OcrQueueOutboxRecord],
      markDeliveredResult: Boolean,
      releaseForRetryResult: Boolean,
      rearmResult: Int,
      nextWakeAtResult: Option[Instant],
  ): IO[RecordingOcrQueueOutboxRepository] = createWithClaimScheduleAndBacklog(
    call => claimRows(call).map(OcrQueueOutboxClaim.Publish.apply),
    markDeliveredResult,
    releaseForRetryResult,
    _ => emptyBacklog,
    rearmResult,
    nextWakeAtResult,
    failInvalidClaimResult = true,
  )

  private def createWithClaimScheduleAndBacklog(
      claimRows: OutboxClaimDueCall => List[OcrQueueOutboxClaim],
      markDeliveredResult: Boolean,
      releaseForRetryResult: Boolean,
      backlogSnapshotRows: Instant => OcrQueueBacklogSnapshot,
      rearmResult: Int,
      nextWakeAtResult: Option[Instant],
      failInvalidClaimResult: Boolean,
  ): IO[RecordingOcrQueueOutboxRepository] =
    for
      claims <- Ref.of[IO, Vector[OutboxClaimDueCall]](Vector.empty)
      rearms <- Ref.of[IO, Vector[OutboxRearmCall]](Vector.empty)
      nextWakeAts <- Ref.of[IO, Vector[OutboxNextWakeCall]](Vector.empty)
      invalidFailures <- Ref.of[IO, Vector[OutboxFailInvalidClaimCall]](Vector.empty)
      deliveries <- Ref.of[IO, Vector[OutboxMarkDeliveredCall]](Vector.empty)
      releases <- Ref.of[IO, Vector[OutboxReleaseForRetryCall]](Vector.empty)
    yield new RecordingOcrQueueOutboxRepository(
      claimRows,
      backlogSnapshotRows,
      rearmResult,
      nextWakeAtResult,
      failInvalidClaimResult,
      markDeliveredResult,
      releaseForRetryResult,
      claims,
      rearms,
      nextWakeAts,
      invalidFailures,
      deliveries,
      releases,
    )

final case class StaticOcrJobQueueHealthCheck(deadLetterLengthValue: Long = 0L)
    extends OcrJobQueueHealthCheck[IO]:
  override def ping: IO[Unit] = IO.unit
  override def deadLetterLength: IO[Long] = IO.pure(deadLetterLengthValue)

final case class FailingOcrJobQueueHealthCheck(
    pingError: Option[Throwable],
    deadLetterLengthError: Option[Throwable],
) extends OcrJobQueueHealthCheck[IO]:
  override def ping: IO[Unit] = pingError match
    case None => IO.unit
    case Some(error) => IO.raiseError(error)
  override def deadLetterLength: IO[Long] = deadLetterLengthError match
    case None => IO.pure(0L)
    case Some(error) => IO.raiseError(error)

final case class SuccessfulDiscordOAuthClient(userId: String) extends DiscordOAuthClient[IO]:
  override def authorizationUrl(state: String, prompt: Option[String]): IO[String] =
    val _ = prompt
    IO.pure(s"https://discord.example/oauth?state=$state")
  override def fetchUser(code: String): IO[Either[AppError, DiscordUser]] =
    val _ = code
    IO.pure(Right(DiscordUser(userId)))

final class RecordingDiscordOAuthClient private (
    result: Either[AppError, DiscordUser],
    fetchCallRef: Ref[IO, Int],
) extends DiscordOAuthClient[IO]:
  def fetchCalls: IO[Int] = fetchCallRef.get

  override def authorizationUrl(state: String, prompt: Option[String]): IO[String] =
    val _ = prompt
    IO.pure(s"https://discord.example/oauth?state=$state")

  override def fetchUser(code: String): IO[Either[AppError, DiscordUser]] =
    val _ = code
    fetchCallRef.update(_ + 1).as(result)

object RecordingDiscordOAuthClient:
  def create(result: Either[AppError, DiscordUser]): IO[RecordingDiscordOAuthClient] = Ref
    .of[IO, Int](0).map(new RecordingDiscordOAuthClient(result, _))

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
