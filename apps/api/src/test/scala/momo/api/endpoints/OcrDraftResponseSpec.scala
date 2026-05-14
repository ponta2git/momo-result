package momo.api.endpoints

import java.time.Instant

import io.circe.Json
import munit.FunSuite

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.domain.{OcrDraft, ScreenType}
import momo.api.errors.AppError

final class OcrDraftResponseSpec extends FunSuite:
  private val now = Instant.parse("2026-05-14T00:00:00Z")

  test("OcrDraftResponse rejects invalid stored JSON instead of replacing it with null"):
    val draft = validDraft.copy(payloadJson = "{")

    OcrDraftResponse.from(draft) match
      case Left(AppError.Internal(detail)) =>
        assert(detail.contains("payloadJson"), s"expected field name in error: $detail")
      case other => fail(s"expected invalid JSON to produce AppError.Internal, got: $other")

  test("OcrDraftResponse preserves JSON payload fields"):
    val result = OcrDraftResponse.from(validDraft)

    assertEquals(result.map(_.payloadJson.hcursor.get[String]("score").toOption), Right(Some("10")))
    assertEquals(result.map(_.warningsJson), Right(Json.arr()))
    assertEquals(result.map(_.timingsMsJson), Right(Json.obj()))

  private def validDraft: OcrDraft = OcrDraft(
    id = OcrDraftId.unsafeFromString("draft-response-1"),
    jobId = OcrJobId.unsafeFromString("job-response-1"),
    requestedScreenType = ScreenType.TotalAssets,
    detectedScreenType = None,
    profileId = None,
    payloadJson = """{"score":"10"}""",
    warningsJson = "[]",
    timingsMsJson = "{}",
    createdAt = now,
    updatedAt = now,
  )
