package momo.api.usecases

import cats.effect.IO
import momo.api.adapters.InMemoryOcrDraftsRepository
import momo.api.adapters.InMemoryOcrJobsRepository
import momo.api.adapters.InMemoryQueueProducer
import momo.api.adapters.LocalFsImageStore
import momo.api.domain.OcrJobHints
import momo.api.domain.ids.*
import momo.api.errors.AppError
import munit.CatsEffectSuite

import java.nio.file.Files
import java.time.Instant

final class CreateOcrJobSpec extends CatsEffectSuite:
  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  private def fromAppEither[A](value: Either[AppError, A]): IO[A] =
    value match
      case Right(result) => IO.pure(result)
      case Left(error)   => IO.raiseError(new RuntimeException(error.detail))

  test("creates empty draft, queued job, and stream payload") {
    for
      dir <- IO.blocking(Files.createTempDirectory("momo-api-create-job"))
      imageStore = LocalFsImageStore[IO](dir)
      image <- imageStore
        .save(Some("sample.png"), Some("image/png"), pngBytes)
        .flatMap(fromAppEither)
      jobs <- InMemoryOcrJobsRepository.create[IO]
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      queue <- InMemoryQueueProducer.create[IO]
      ids <- IO.ref(List("job-1", "draft-1"))
      usecase = CreateOcrJob[IO](
        imageStore = imageStore,
        jobs = jobs,
        drafts = drafts,
        queue = queue,
        now = IO.pure(Instant.parse("2026-04-29T11:40:16Z")),
        nextId = ids.modify {
          case head :: tail => tail -> head
          case Nil          => Nil -> "unexpected"
        }
      )
      created <- usecase
        .run(CreateOcrJobCommand(image.imageId.value, "total_assets", OcrJobHints()))
        .flatMap(fromAppEither)
      foundJob <- jobs.find(created.job.id)
      foundDraft <- drafts.find(created.draft.id)
      published <- queue.published
    yield
      assertEquals(foundJob.map(_.status.wire), Some("queued"))
      assertEquals(foundDraft.map(_.id), Some(created.draft.id))
      assertEquals(published.map(_.fields("jobId")), Vector("job-1"))
      assertEquals(published.head.fields("requestedImageType"), "total_assets")
  }
