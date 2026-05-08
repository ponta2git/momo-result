package momo.api.usecases

import java.time.Instant

import cats.effect.IO
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryMatchDraftsRepository, InMemoryOcrDraftsRepository, InMemoryOcrJobCreationRepository,
  InMemoryOcrJobsRepository, InMemoryQueueProducer, LocalFsImageStore,
}
import momo.api.domain.ids.OcrJobId
import momo.api.domain.{OcrFailure, OcrJob, OcrJobHints}
import momo.api.errors.AppError
import momo.api.repositories.{OcrJobsRepository, OcrQueuePayload, QueueProducer}
import momo.api.usecases.testing.CapturingLoggerFactory

final class CreateOcrJobSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  private def fromAppEither[A](value: Either[AppError, A]): IO[A] = value match
    case Right(result) => IO.pure(result)
    case Left(error) => IO.raiseError(new RuntimeException(error.detail))

  test("creates empty draft, queued job, and stream payload") {
    tempDirectory("momo-api-create-job").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
          .flatMap(fromAppEither)
        jobs <- InMemoryOcrJobsRepository.create[IO]
        drafts <- InMemoryOcrDraftsRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        creation = InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts)
        queue <- InMemoryQueueProducer.create[IO]
        submitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, queue)
        ids <- IO.ref(List("job-1", "draft-1"))
        usecase = CreateOcrJob[IO](
          imageStore = imageStore,
          creation = creation,
          matchDrafts = matchDrafts,
          queueSubmitter = submitter,
          now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
          nextId = ids.modify {
            case head :: tail => tail -> head
            case Nil => Nil -> "unexpected"
          },
          requestIdLookup = IO.pure(Some("test-req-id")),
        )
        created <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
          .flatMap(fromAppEither)
        foundJob <- jobs.find(created.job.id)
        foundDraft <- drafts.find(created.draft.id)
        published <- queue.published
      yield
        assertEquals(foundJob.map(_.status.wire), Some("queued"))
        assertEquals(foundDraft.map(_.id), Some(created.draft.id))
        assertEquals(published.map(_.fields("jobId")), Vector("job-1"))
        assertEquals(published.head.fields("requestedImageType"), "total_assets")
        assertEquals(published.head.fields.get("requestId"), Some("test-req-id"))
    }
  }

  test("returns DependencyFailed and does not raise when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    val failingQueue: QueueProducer[IO] = new QueueProducer[IO]:
      override def publish(payload: OcrQueuePayload): IO[String] = IO.raiseError(queueError)
      override def ping: IO[Unit] = IO.unit

    def failingJobs(delegate: OcrJobsRepository[IO]): OcrJobsRepository[IO] =
      new OcrJobsRepository[IO]:
        override def create(job: OcrJob): IO[Unit] = delegate.create(job)
        override def find(jobId: OcrJobId): IO[Option[OcrJob]] = delegate.find(jobId)
        override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): IO[Unit] = IO
          .raiseError(markFailedError)
        override def cancelQueued(jobId: OcrJobId, now: Instant): IO[Boolean] = delegate
          .cancelQueued(jobId, now)

    tempDirectory("momo-api-create-job-fail").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
          .flatMap(fromAppEither)
        jobsBase <- InMemoryOcrJobsRepository.create[IO]
        jobs = failingJobs(jobsBase)
        drafts <- InMemoryOcrDraftsRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        creation = InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts)
        submitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, failingQueue)
        ids <- IO.ref(List("job-1", "draft-1"))
        usecase = CreateOcrJob[IO](
          imageStore = imageStore,
          creation = creation,
          matchDrafts = matchDrafts,
          queueSubmitter = submitter,
          now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
          nextId = ids.modify {
            case head :: tail => tail -> head
            case Nil => Nil -> "unexpected"
          },
          requestIdLookup = IO.pure(None),
        )
        result <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
      yield result match
        case Left(_: AppError.DependencyFailed) => ()
        case other => fail(s"expected Left(AppError.DependencyFailed), got: $other")
    }
  }

  test("stores sanitized failure message when queue.publish fails") {
    val queueError = new RuntimeException("redis://secret-host/boom")
    val failingQueue: QueueProducer[IO] = new QueueProducer[IO]:
      override def publish(payload: OcrQueuePayload): IO[String] = IO.raiseError(queueError)
      override def ping: IO[Unit] = IO.unit

    tempDirectory("momo-api-create-job-sanitized-failure").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
          .flatMap(fromAppEither)
        jobs <- InMemoryOcrJobsRepository.create[IO]
        drafts <- InMemoryOcrDraftsRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        creation = InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts)
        submitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, failingQueue)
        ids <- IO.ref(List("job-1", "draft-1"))
        usecase = CreateOcrJob[IO](
          imageStore = imageStore,
          creation = creation,
          matchDrafts = matchDrafts,
          queueSubmitter = submitter,
          now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
          nextId = ids.modify {
            case head :: tail => tail -> head
            case Nil => Nil -> "unexpected"
          },
          requestIdLookup = IO.pure(None),
        )
        _ <- usecase
          .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints.empty, None))
        found <- jobs.find(OcrJobId("job-1"))
      yield
        val failure = found.flatMap(_.failure).getOrElse(fail("expected failed job"))
        assertEquals(failure.message, "Failed to enqueue OCR job.")
        assert(!failure.message.contains("secret-host"))
    }
  }

  test("logs publish and compensation failures when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    val failingQueue: QueueProducer[IO] = new QueueProducer[IO]:
      override def publish(payload: OcrQueuePayload): IO[String] = IO.raiseError(queueError)
      override def ping: IO[Unit] = IO.unit

    def failingJobs(delegate: OcrJobsRepository[IO]): OcrJobsRepository[IO] =
      new OcrJobsRepository[IO]:
        override def create(job: OcrJob): IO[Unit] = delegate.create(job)
        override def find(jobId: OcrJobId): IO[Option[OcrJob]] = delegate.find(jobId)
        override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): IO[Unit] = IO
          .raiseError(markFailedError)
        override def cancelQueued(jobId: OcrJobId, now: Instant): IO[Boolean] = delegate
          .cancelQueued(jobId, now)

    tempDirectory("momo-api-create-job-log").use { dir =>
      for
        capture <- CapturingLoggerFactory.create[IO]
        (factory, ref) = capture
        given LoggerFactory[IO] = factory
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
          .flatMap(fromAppEither)
        jobsBase <- InMemoryOcrJobsRepository.create[IO]
        jobs = failingJobs(jobsBase)
        drafts <- InMemoryOcrDraftsRepository.create[IO]
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        creation = InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts)
        submitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, failingQueue)
        ids <- IO.ref(List("job-log-1", "draft-log-1"))
        usecase = CreateOcrJob[IO](
          imageStore = imageStore,
          creation = creation,
          matchDrafts = matchDrafts,
          queueSubmitter = submitter,
          now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
          nextId = ids.modify {
            case head :: tail => tail -> head
            case Nil => Nil -> "unexpected"
          },
          requestIdLookup = IO.pure(None),
        )
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
