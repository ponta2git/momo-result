package momo.api.adapters

import io.circe.Json
import momo.api.domain.OcrJobHints
import momo.api.domain.PlayerAliasHint
import momo.api.domain.ScreenType
import momo.api.domain.ids.*
import munit.FunSuite

import java.nio.file.Path
import java.time.Instant

final class OcrStreamPayloadSpec extends FunSuite:
  test("builds the exact Redis Streams payload expected by the OCR worker without hints") {
    val payload = OcrStreamPayload.build(
      jobId = JobId("job-1"),
      draftId = DraftId("draft-1"),
      imageId = ImageId("image-1"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-1.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints()
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
        "enqueuedAt" -> "2026-04-29T11:40:16Z"
      )
    )
  }

  test("serializes hints as compact sorted UTF-8 JSON") {
    val payload = OcrStreamPayload.build(
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
        computerPlayerAliases = List("さくま", "サクマ")
      )
    )

    assertEquals(
      payload.fields(OcrStreamPayload.HintsKey),
      """{"computerPlayerAliases":["さくま","サクマ"],"gameTitle":"桃太郎電鉄ワールド","knownPlayerAliases":[{"aliases":["ぽんた","PONTA"],"memberId":"member-1"}],"layoutFamily":"world"}"""
    )
  }

  test("fieldsAsJson is deterministic by key order") {
    val json = OcrStreamPayload.fieldsAsJson(OcrStreamPayload(Map("b" -> "2", "a" -> "1")))

    assertEquals(json, Json.obj("a" -> Json.fromString("1"), "b" -> Json.fromString("2")))
  }
