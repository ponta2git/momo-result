package momo.api.usecases

import java.nio.file.Files
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryMatchDraftsRepository, InMemoryOcrDraftsRepository, InMemoryOcrJobsRepository,
  InMemoryQueueProducer, LocalFsImageStore,
}
import momo.api.domain.ids.OcrJobId
import momo.api.domain.{OcrFailure, OcrJob, OcrJobHints}
import momo.api.errors.AppError
import momo.api.repositories.{OcrJobsRepository, OcrQueuePayload, QueueProducer}

final class CreateOcrJobSpec extends MomoCatsEffectSuite:
  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  private def fromAppEither[A](value: Either[AppError, A]): IO[A] = value match
    case Right(result) => IO.pure(result)
    case Left(error) => IO.raiseError(new RuntimeException(error.detail))

  test("creates empty draft, queued job, and stream payload") {
    for
      dir <- IO.blocking(Files.createTempDirectory("momo-api-create-job"))
      imageStore = LocalFsImageStore[IO](dir)
      image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
        .flatMap(fromAppEither)
      jobs <- InMemoryOcrJobsRepository.create[IO]
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      queue <- InMemoryQueueProducer.create[IO]
      ids <- IO.ref(List("job-1", "draft-1"))
      usecase = CreateOcrJob[IO](
        imageStore = imageStore,
        jobs = jobs,
        drafts = drafts,
        matchDrafts = matchDrafts,
        queue = queue,
        now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
        nextId = ids.modify {
          case head :: tail => tail -> head
          case Nil => Nil -> "unexpected"
        },
        requestIdLookup = IO.pure(Some("test-req-id")),
      )
      created <- usecase
        .run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints(), None))
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

  test("returns Internal and does not raise when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    val failingQueue: QueueProducer[IO] = new QueueProducer[IO]:
      override def publish(payload: OcrQueuePayload): IO[Unit] = IO.raiseError(queueError)

    def failingJobs(delegate: OcrJobsRepository[IO]): OcrJobsRepository[IO] =
      new OcrJobsRepository[IO]:
        override def create(job: OcrJob): IO[Unit] = delegate.create(job)
        override def find(jobId: OcrJobId): IO[Option[OcrJob]] = delegate.find(jobId)
        override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): IO[Unit] = IO
          .raiseError(markFailedError)
        override def cancelQueued(jobId: OcrJobId, now: Instant): IO[Boolean] = delegate
          .cancelQueued(jobId, now)

    for
      dir <- IO.blocking(Files.createTempDirectory("momo-api-create-job-fail"))
      imageStore = LocalFsImageStore[IO](dir)
      image <- imageStore.save(Some("sample.png"), Some("image/png"), pngBytes)
        .flatMap(fromAppEither)
      jobsBase <- InMemoryOcrJobsRepository.create[IO]
      jobs = failingJobs(jobsBase)
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      ids <- IO.ref(List("job-1", "draft-1"))
      usecase = CreateOcrJob[IO](
        imageStore = imageStore,
        jobs = jobs,
        drafts = drafts,
        matchDrafts = matchDrafts,
        queue = failingQueue,
        now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
        nextId = ids.modify {
          case head :: tail => tail -> head
          case Nil => Nil -> "unexpected"
        },
        requestIdLookup = IO.pure(None),
      )
      result <- usecase.run(CreateOcrJobCommand(image.imageId, "total_assets", OcrJobHints(), None))
    yield result match
      case Left(_: AppError.Internal) => ()
      case other => fail(s"expected Left(AppError.Internal), got: $other")
  }
