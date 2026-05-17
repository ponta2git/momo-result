package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.InMemoryOcrDraftsRepository
import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, ScreenType}
import momo.api.errors.AppError

final class GetOcrDraftsBulkSpec extends MomoCatsEffectSuite:
  private val timestamp = Instant.parse("2026-04-29T11:40:16Z")

  private def draft(id: String, jobId: String): OcrDraft = OcrDraft(
    id = OcrDraftId.unsafeFromString(id),
    jobId = OcrJobId.unsafeFromString(jobId),
    requestedScreenType = ScreenType.TotalAssets,
    detectedScreenType = None,
    profileId = None,
    payloadJson = """{"players":[]}""",
    warningsJson = "[]",
    timingsMsJson = "{}",
    createdAt = timestamp,
    updatedAt = timestamp,
  )

  test("returns drafts in requested order") {
    for
      repo <- InMemoryOcrDraftsRepository.create[IO]
      _ <- repo.create(draft("draft-1", "job-1"))
      _ <- repo.create(draft("draft-2", "job-2"))
      result <- GetOcrDraftsBulk[IO](repo)
        .run(List(OcrDraftId.unsafeFromString("draft-2"), OcrDraftId.unsafeFromString("draft-1")))
    yield assertEquals(result.map(_.map(_.id.value)), Right(List("draft-2", "draft-1")))
  }

  test("rejects empty ids query") {
    for
      repo <- InMemoryOcrDraftsRepository.create[IO]
      result <- GetOcrDraftsBulk[IO](repo).run(Nil)
    yield assertEquals(
      result,
      Left(AppError.ValidationFailed("ids query must contain at least 1 id.")),
    )
  }

  test("rejects too many ids before repository lookups") {
    val ids = (1 to (OcrDraft.MaxBulkIds + 1)).toList
      .map(index => OcrDraftId.unsafeFromString(s"draft-$index"))
    for
      repo <- InMemoryOcrDraftsRepository.create[IO]
      result <- GetOcrDraftsBulk[IO](repo).run(ids)
    yield assertEquals(
      result,
      Left(AppError.ValidationFailed(s"ids query must contain at most ${OcrDraft.MaxBulkIds
          .toString} ids.")),
    )
  }

  test("returns not found when any requested draft is missing") {
    for
      repo <- InMemoryOcrDraftsRepository.create[IO]
      _ <- repo.create(draft("draft-1", "job-1"))
      result <- GetOcrDraftsBulk[IO](repo)
        .run(List(OcrDraftId.unsafeFromString("draft-1"), OcrDraftId.unsafeFromString("missing")))
    yield assertEquals(result, Left(AppError.NotFound("ocr draft", "missing")))
  }
