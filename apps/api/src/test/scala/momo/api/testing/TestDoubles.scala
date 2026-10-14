package momo.api.testing
import java.time.Instant

import scala.concurrent.duration.*

import cats.Applicative
import cats.effect.{Clock, IO, Ref}
import fs2.Stream

import momo.api.auth.{DiscordOAuthClient, DiscordUser}
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.domain.{StoredImage, StoredImageLocation}
import momo.api.errors.AppError
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.{AppSession, AppSessionsRepository}

object FixedClock:
  def at(now: Instant): Clock[IO] = new Clock[IO]:
    override val applicative: Applicative[IO] = Applicative[IO]
    override def monotonic: IO[FiniteDuration] = IO.pure(0.nanos)
    override def realTime: IO[FiniteDuration] = IO
      .pure(java.time.Duration.between(Instant.EPOCH, now).toNanos.nanos)

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
        sessions = s.sessions.updatedWith(idHash)(_.map(session =>
          session.copy(
            lastSeenAt = if lastSeenAt.isAfter(session.lastSeenAt) then lastSeenAt
            else session.lastSeenAt,
            expiresAt = if expiresAt.isAfter(session.expiresAt) then expiresAt
            else session.expiresAt,
          )
        )),
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
