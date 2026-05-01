package momo.api.repositories

import io.circe.Json
import java.nio.file.Path
import java.time.Instant
import momo.api.domain.{OcrJobHints, PlayerAliasHint, ScreenType}
import momo.api.domain.ids.*
import munit.FunSuite

final class OcrQueuePayloadSpec extends FunSuite:
  test("builds the exact Redis Streams payload expected by the OCR worker without hints") {
    val payload = OcrQueuePayload.build(
      jobId = JobId("job-1"),
      draftId = DraftId("draft-1"),
      imageId = ImageId("image-1"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-1.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints(),
    )

    assertEquals(
      payload.fields,
      Map(
        "jobId" -> "job-1",
        "draftId" -> "draft-1",
        "imageId" -> "image-1",
        "imagePath" -> "/tmp/momo-result/uploads/image-1.png",
        "requestedImageType" -> "total_assets",
        "attempt" -> "1",
        "enqueuedAt" -> "2026-04-29T11:40:16Z",
      ),
    )
  }

  test("serializes hints as compact sorted UTF-8 JSON") {
    val payload = OcrQueuePayload.build(
      jobId = JobId("job-2"),
      draftId = DraftId("draft-2"),
      imageId = ImageId("image-2"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-2.webp"),
      requestedScreenType = ScreenType.Auto,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints(
        gameTitle = Some("桃太郎電鉄ワールド"),
        layoutFamily = Some("world"),
        knownPlayerAliases = List(PlayerAliasHint("member-1", List("ぽんた", "PONTA"))),
        computerPlayerAliases = List("さくま", "サクマ"),
      ),
    )

    assertEquals(
      payload.fields(OcrQueuePayload.HintsKey),
      """{"computerPlayerAliases":["さくま","サクマ"],"gameTitle":"桃太郎電鉄ワールド","knownPlayerAliases":[{"aliases":["ぽんた","PONTA"],"memberId":"member-1"}],"layoutFamily":"world"}""",
    )
  }

  test("includes requestId when provided and omits it when empty/None") {
    val basePayload = OcrQueuePayload.build(
      jobId = JobId("job-3"),
      draftId = DraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints(),
    )
    assertEquals(basePayload.fields.get(OcrQueuePayload.RequestIdKey), None)

    val withId = OcrQueuePayload.build(
      jobId = JobId("job-3"),
      draftId = DraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints(),
      requestId = Some("abc-123_DEF"),
    )
    assertEquals(withId.fields.get(OcrQueuePayload.RequestIdKey), Some("abc-123_DEF"))

    val withEmpty = OcrQueuePayload.build(
      jobId = JobId("job-3"),
      draftId = DraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints(),
      requestId = Some(""),
    )
    assertEquals(withEmpty.fields.get(OcrQueuePayload.RequestIdKey), None)
  }

  test("fieldsAsJson is deterministic by key order") {
    val json = OcrQueuePayload.fieldsAsJson(OcrQueuePayload(Map("b" -> "2", "a" -> "1")))

    assertEquals(json, Json.obj("a" -> Json.fromString("1"), "b" -> Json.fromString("2")))
  }
