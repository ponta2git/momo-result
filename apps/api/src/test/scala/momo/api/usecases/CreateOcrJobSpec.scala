package momo.api.usecases

import java.time.Instant

import cats.effect.{IO, Resource}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryMatchDraftsRepository, InMemoryOcrDraftsRepository, InMemoryOcrJobCreationRepository,
  InMemoryOcrJobsRepository, InMemoryQueueProducer, LocalFsImageStore,
}
import momo.api.domain.ids.{ImageId, OcrJobId}
import momo.api.domain.{OcrFailure, OcrJob, OcrJobHints, PlayerAliasHint, StoredImage}
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, OcrJobsRepository, OcrQueuePayload, QueueProducer}
import momo.api.usecases.testing.CapturingLoggerFactory

final class CreateOcrJobSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val now = Instant.parse("2026-04-29T11:40:16Z")

  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  private def fromAppEither[A](value: Either[AppError, A]): IO[A] = value match
    case Right(result) => IO.pure(result)
    case Left(error) => IO.raiseError(new RuntimeException(error.detail))

  test("creates empty draft, queued job, and stream payload") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job",
      idSeed = List("job-1", "draft-1"),
      requestId = Some("test-req-id"),
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        created <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
          .flatMap(fromAppEither)
        foundJob <- fixture.jobs.find(created.job.id)
        foundDraft <- fixture.drafts.find(created.draft.id)
        published <- fixture.queue.published
      yield
        assertEquals(foundJob.map(_.status.wire), Some("queued"))
        assertEquals(foundDraft.map(_.id), Some(created.draft.id))
        assertEquals(published.map(_.fields("jobId")), Vector("job-1"))
        assertEquals(published.head.fields("schemaVersion"), "1")
        assertEquals(published.head.fields("requestedImageType"), "total_assets")
        assertEquals(published.head.fields.get("requestId"), Some("test-req-id"))
    }
  }

  test("returns DependencyFailed and does not raise when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    fixtureResource(
      prefix = "momo-api-create-job-fail",
      queue = failingQueue(queueError),
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      decorateJobs = failingJobs(_, markFailedError),
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
      yield result match
        case Left(_: AppError.DependencyFailed) => ()
        case other => fail(s"expected Left(AppError.DependencyFailed), got: $other")
    }
  }

  test("stores sanitized failure message when queue.publish fails") {
    val queueError = new RuntimeException("redis://secret-host/boom")

    fixtureResource(
      prefix = "momo-api-create-job-sanitized-failure",
      queue = failingQueue(queueError),
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      decorateJobs = identity[OcrJobsRepository[IO]],
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        _ <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
        found <- fixture.jobs.find(OcrJobId("job-1"))
      yield
        val failure = found.flatMap(_.failure).getOrElse(fail("expected failed job"))
        assertEquals(failure.message, "Failed to enqueue OCR job.")
        assert(!failure.message.contains("secret-host"))
    }
  }

  test("rejects OCR hints that exceed Redis payload contract limits") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-hints-limit",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
    ).use { fixture =>
      for
        usecase <- fixture.usecase
        result <- usecase.run(CreateOcrJobCommand(
          ImageId("missing-image"),
          "total_assets",
          OcrJobHints(
            gameTitle = None,
            layoutFamily = None,
            knownPlayerAliases = List(PlayerAliasHint("member-1", List.fill(9)("alias"))),
            computerPlayerAliases = Nil,
          ),
          None,
        ))
      yield result match
        case Left(AppError.ValidationFailed(detail)) =>
          assert(detail.contains("ocrHints.knownPlayerAliases[0].aliases"))
        case other => fail(s"expected Left(AppError.ValidationFailed), got: $other")
    }
  }

  test("logs publish and compensation failures when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    fixtureResource(
      prefix = "momo-api-create-job-log",
      queue = failingQueue(queueError),
      idSeed = List("job-log-1", "draft-log-1"),
      requestId = None,
      decorateJobs = failingJobs(_, markFailedError),
    ).use { fixture =>
      for
        capture <- CapturingLoggerFactory.create[IO]
        (factory, ref) = capture
        given LoggerFactory[IO] = factory
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
        logged <- ref.get
      yield
        // Original dependency failure is still surfaced to the caller (enqueue failure not swallowed).
        result match
          case Left(_: AppError.DependencyFailed) => ()
          case other => fail(s"expected Left(AppError.DependencyFailed), got: $other")
        // Original publish failure and secondary compensation failure are both logged.
        assertEquals(logged.size, 2)
        val entry = logged(1)
        assertEquals(entry.throwable, Some(markFailedError))
        assert(
          entry.message.contains("jobId=job-log-1"),
          s"message missing jobId: ${entry.message}",
        )
        assert(
          entry.message.contains("draftId=draft-log-1"),
          s"message missing draftId: ${entry.message}",
        )
        assert(
          entry.message.contains("compensation"),
          s"message missing 'compensation' marker: ${entry.message}",
        )
    }
  }

  private def inMemoryQueueFixture(
      prefix: String,
      idSeed: List[String],
      requestId: Option[String],
  ): Resource[IO, Fixture[InMemoryQueueProducer[IO]]] = Resource
    .eval(InMemoryQueueProducer.create[IO]).flatMap(queue =>
      fixtureResource(
        prefix = prefix,
        queue = queue,
        idSeed = idSeed,
        requestId = requestId,
        decorateJobs = identity[OcrJobsRepository[IO]],
      )
    )

  private def fixtureResource[Q <: QueueProducer[IO]](
      prefix: String,
      queue: Q,
      idSeed: List[String],
      requestId: Option[String],
      decorateJobs: OcrJobsRepository[IO] => OcrJobsRepository[IO],
  ): Resource[IO, Fixture[Q]] = tempDirectory(prefix).evalMap { dir =>
    for
      jobsBase <- InMemoryOcrJobsRepository.create[IO]
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      imageStore = LocalFsImageStore[IO](dir)
      jobs = decorateJobs(jobsBase)
    yield Fixture(imageStore, jobs, drafts, matchDrafts, queue, idSeed, requestId)
  }

  private def failingQueue(error: Throwable): QueueProducer[IO] = new QueueProducer[IO]:
    override def publish(payload: OcrQueuePayload): IO[String] =
      val _ = payload
      IO.raiseError(error)
    override def ping: IO[Unit] = IO.unit

  private def failingJobs(
      delegate: OcrJobsRepository[IO],
      markFailedError: Throwable,
  ): OcrJobsRepository[IO] = new OcrJobsRepository[IO]:
    override def create(job: OcrJob): IO[Unit] = delegate.create(job)
    override def find(jobId: OcrJobId): IO[Option[OcrJob]] = delegate.find(jobId)
    override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): IO[Unit] =
      val _ = (jobId, failure, now)
      IO.raiseError(markFailedError)
    override def cancelQueued(jobId: OcrJobId, now: Instant): IO[Boolean] = delegate
      .cancelQueued(jobId, now)

  private final case class Fixture[Q <: QueueProducer[IO]](
      imageStore: ImageStore[IO],
      jobs: OcrJobsRepository[IO],
      drafts: InMemoryOcrDraftsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      queue: Q,
      idSeed: List[String],
      requestId: Option[String],
  ):
    def savePng: IO[StoredImage] = imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
      .flatMap(fromAppEither)

    def usecase(using LoggerFactory[IO]): IO[CreateOcrJob[IO]] = IO.ref(idSeed).map { ids =>
      CreateOcrJob[IO](
        imageStore = imageStore,
        creation = InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts),
        matchDrafts = matchDrafts,
        queueSubmitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, queue),
        now = IO.pure(now),
        nextId = ids.modify {
          case head :: tail => tail -> head
          case Nil => Nil -> "unexpected"
        },
        requestIdLookup = IO.pure(requestId),
      )
    }
