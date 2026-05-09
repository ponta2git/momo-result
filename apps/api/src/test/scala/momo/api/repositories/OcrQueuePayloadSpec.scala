package momo.api.repositories

import java.nio.file.Path
import java.time.Instant

import io.circe.Json
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, PlayerAliasHint, ScreenType}
import momo.api.testing.JsonSchemaAssertions

final class OcrQueuePayloadSpec extends FunSuite with JsonSchemaAssertions:
  test("builds a JSON Schema-valid Redis Streams payload with hints and requestId") {
    val payload = canonicalPayload

    assertEquals(payload.fields("jobId"), "job-schema-1")
    assertEquals(payload.fields("draftId"), "draft-schema-1")
    assertEquals(payload.fields("imageId"), "image-schema-1")
    assertEquals(payload.fields("imagePath"), "/tmp/momo-result/uploads/image-schema-1.png")
    assertEquals(payload.fields("requestedImageType"), "incident_log")
    assertEquals(payload.fields("attempt"), "1")
    assertEquals(payload.fields("enqueuedAt"), "2026-05-09T00:00:00Z")
    assertEquals(payload.fields("schemaVersion"), "1")
    assertEquals(payload.fields("requestId"), "req_20260509-abc")
    assertOcrQueuePayloadSchemaValid(payload)
  }

  test("JSON Schema rejects invalid Redis Streams payload shape") {
    val baseJson = OcrQueuePayload.fieldsAsJson(canonicalPayload)

    assertJsonSchemaInvalid(
      streamPayloadSchemaPath,
      baseJson.mapObject(_.add("attempt", Json.fromInt(1))).noSpaces,
    )
    assertJsonSchemaInvalid(
      streamPayloadSchemaPath,
      baseJson.mapObject(_.add("enqueuedAt", Json.fromString("not-a-date-time"))).noSpaces,
    )
    assertJsonSchemaInvalid(
      streamPayloadSchemaPath,
      baseJson.mapObject(_.add("unknownField", Json.fromString("value"))).noSpaces,
    )
    assertJsonSchemaInvalid(
      streamPayloadSchemaPath,
      baseJson.mapObject(_.add("schemaVersion", Json.fromString("2"))).noSpaces,
    )
    assertJsonSchemaInvalid(
      streamPayloadSchemaPath,
      baseJson.mapObject(_.add(OcrQueuePayload.HintsKey, Json.fromString("x" * 8193))).noSpaces,
    )
  }

  test("JSON Schema rejects OCR hints that exceed contract limits") {
    val oversizedAliases = Json.obj(
      "knownPlayerAliases" -> Json.arr(Json.obj(
        "memberId" -> Json.fromString("member-1"),
        "aliases" -> Json.arr(List.fill(9)(Json.fromString("alias"))*),
      ))
    )

    assertJsonSchemaInvalid(ocrHintsSchemaPath, oversizedAliases.noSpaces)
    assertJsonSchemaInvalid(
      ocrHintsSchemaPath,
      Json.obj(
        "knownPlayerAliases" -> Json.arr(
          List.fill(5)(Json.obj(
            "memberId" -> Json.fromString("member-1"),
            "aliases" -> Json.arr(Json.fromString("alias")),
          ))*
        )
      ).noSpaces,
    )
    assertJsonSchemaInvalid(
      ocrHintsSchemaPath,
      Json.obj("computerPlayerAliases" -> Json.arr(Json.fromString("x" * 65))).noSpaces,
    )
  }

  test("builds the exact Redis Streams payload expected by the OCR worker without hints") {
    val payload = OcrQueuePayload.build(
      jobId = OcrJobId("job-1"),
      draftId = OcrDraftId("draft-1"),
      imageId = ImageId("image-1"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-1.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints.empty,
      requestId = None,
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
        "schemaVersion" -> "1",
      ),
    )
    assertOcrQueuePayloadSchemaValid(payload)
  }

  test("serializes hints as compact sorted UTF-8 JSON") {
    val payload = OcrQueuePayload.build(
      jobId = OcrJobId("job-2"),
      draftId = OcrDraftId("draft-2"),
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
      requestId = None,
    )

    assertEquals(
      payload.fields(OcrQueuePayload.HintsKey),
      """{"computerPlayerAliases":["さくま","サクマ"],"gameTitle":"桃太郎電鉄ワールド","knownPlayerAliases":[{"aliases":["ぽんた","PONTA"],"memberId":"member-1"}],"layoutFamily":"world"}""",
    )
    assertOcrQueuePayloadSchemaValid(payload)
  }

  test("includes requestId when provided and omits it when empty/None") {
    val basePayload = OcrQueuePayload.build(
      jobId = OcrJobId("job-3"),
      draftId = OcrDraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints.empty,
      requestId = None,
    )
    assertEquals(basePayload.fields.get(OcrQueuePayload.RequestIdKey), None)

    val withId = OcrQueuePayload.build(
      jobId = OcrJobId("job-3"),
      draftId = OcrDraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints.empty,
      requestId = Some("abc-123_DEF"),
    )
    assertEquals(withId.fields.get(OcrQueuePayload.RequestIdKey), Some("abc-123_DEF"))

    val withEmpty = OcrQueuePayload.build(
      jobId = OcrJobId("job-3"),
      draftId = OcrDraftId("draft-3"),
      imageId = ImageId("image-3"),
      imagePath = Path.of("/tmp/momo-result/uploads/image-3.png"),
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = Instant.parse("2026-04-29T11:40:16Z"),
      hints = OcrJobHints.empty,
      requestId = Some(""),
    )
    assertEquals(withEmpty.fields.get(OcrQueuePayload.RequestIdKey), None)
  }

  test("fieldsAsJson is deterministic by key order") {
    val json = OcrQueuePayload.fieldsAsJson(OcrQueuePayload(Map("b" -> "2", "a" -> "1")))

    assertEquals(json, Json.obj("a" -> Json.fromString("1"), "b" -> Json.fromString("2")))
  }

  test("fromJson accepts only string-valued JSON objects") {
    assertEquals(
      OcrQueuePayload.fromJson(Json.obj("jobId" -> Json.fromString("job-1"))),
      Right(OcrQueuePayload(Map("jobId" -> "job-1"))),
    )
    assertEquals(OcrQueuePayload.fromJson(Json.arr()), Left("stream payload must be a JSON object"))
    assertEquals(
      OcrQueuePayload.fromJson(Json.obj("attempt" -> Json.fromInt(1))),
      Left("field attempt must be a string"),
    )
  }

  private def canonicalPayload: OcrQueuePayload = OcrQueuePayload.build(
    jobId = OcrJobId("job-schema-1"),
    draftId = OcrDraftId("draft-schema-1"),
    imageId = ImageId("image-schema-1"),
    imagePath = Path.of("/tmp/momo-result/uploads/image-schema-1.png"),
    requestedScreenType = ScreenType.IncidentLog,
    attempt = 1,
    enqueuedAt = Instant.parse("2026-05-09T00:00:00Z"),
    hints = OcrJobHints(
      gameTitle = Some("桃鉄2"),
      layoutFamily = Some("momotetsu_2"),
      knownPlayerAliases = List(
        PlayerAliasHint("member-ponta", List("ぽんた", "ぽんた社長")),
        PlayerAliasHint("member-otaka", List("オータカ", "オータカ社長")),
      ),
      computerPlayerAliases = List("さくま", "さくま社長"),
    ),
    requestId = Some("req_20260509-abc"),
  )
