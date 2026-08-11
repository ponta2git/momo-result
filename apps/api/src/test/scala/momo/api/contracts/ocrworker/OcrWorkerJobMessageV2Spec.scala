package momo.api.contracts.ocrworker

import java.time.Instant

import io.circe.Json
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.testing.JsonSchemaAssertions

final class OcrWorkerJobMessageV2Spec extends FunSuite with JsonSchemaAssertions:
  test("builds the exact closed Redis Streams v2 payload") {
    val payload = canonicalPayload()

    assertEquals(
      payload.fields,
      Map(
        "schemaVersion" -> "2",
        "jobId" -> "job-v2-1",
        "draftId" -> "draft-v2-1",
        "sourceImageId" -> "image-v2-1",
        "imageObjectKey" -> "source-images/2026/image-v2-1.webp",
        "sha256" -> ("ab" * 32),
        "byteLength" -> "3145728",
        "mediaType" -> "image/webp",
        "requestedScreenType" -> "incident_log",
        "attempt" -> "1",
        "enqueuedAt" -> "2026-08-11T00:00:00Z",
        "requestId" -> "req_v2-1",
      ),
    )
    assertOcrWorkerJobMessageV2SchemaValid(payload)
  }

  test("round-trips a typed payload and rejects non-string or unknown fields") {
    val payload = canonicalPayload()
    val json = OcrWorkerJobMessageV2.fieldsAsJson(payload)

    assertEquals(OcrWorkerJobMessageV2.fromJson(json).map(_.fields), Right(payload.fields))
    assertEquals(
      OcrWorkerJobMessageV2.fromJson(json.mapObject(_.add("attempt", Json.fromInt(1)))),
      Left("field attempt must be a string"),
    )
    assertEquals(
      OcrWorkerJobMessageV2.fromJson(json.mapObject(_.add("bucketUrl", Json.fromString("x")))),
      Left("unknown stream payload field(s): bucketUrl"),
    )
    assertEquals(
      OcrWorkerJobMessageV2.fromJson(json.mapObject(_.add("imagePath", Json.fromString("/tmp/x")))),
      Left("unknown stream payload field(s): imagePath"),
    )
  }

  test("accepts only explicit screen types") {
    val result = build(canonicalInput.copy(requestedScreenType = ScreenType.Auto))
    assertEquals(result, Left("requestedScreenType=auto is not supported by schemaVersion 2"))

    val autoJson = OcrWorkerJobMessageV2.fieldsAsJson(canonicalPayload()).mapObject(
      _.add("requestedScreenType", Json.fromString("auto"))
    )
    assertEquals(
      OcrWorkerJobMessageV2.fromJson(autoJson),
      Left("unknown requestedScreenType=auto"),
    )
    assertJsonSchemaInvalid(streamPayloadV2SchemaPath, autoJson.noSpaces)
  }

  test("rejects URL-like, absolute, ambiguous, or unsafe object keys") {
    List(
      "/source-images/image.png",
      "https://example.invalid/image.png",
      "s3:bucket/image.png",
      "source-images//image.png",
      "source-images/./image.png",
      "source-images/../image.png",
      "source-images/image.png/",
      "source-images/画像.png",
    ).foreach { key =>
      assert(build(canonicalInput.copy(imageObjectKey = key)).isLeft, clues(key))
    }
  }

  test("enforces verified image metadata and the exact 3 MiB boundary") {
    assert(build(canonicalInput.copy(byteLength = 1L)).isRight)
    assert(build(canonicalInput.copy(byteLength = OcrWorkerJobMessageV2.MaxByteLength)).isRight)
    assert(build(canonicalInput.copy(byteLength = 0L)).isLeft)
    assert(
      build(canonicalInput.copy(byteLength = OcrWorkerJobMessageV2.MaxByteLength + 1L)).isLeft
    )
    assert(build(canonicalInput.copy(sha256 = "AB" * 32)).isLeft)
    assert(build(canonicalInput.copy(sha256 = "a" * 63)).isLeft)
    assert(build(canonicalInput.copy(mediaType = "image/gif")).isLeft)
    assert(build(canonicalInput.copy(attempt = 0)).isLeft)

    val baseJson = OcrWorkerJobMessageV2.fieldsAsJson(canonicalPayload())
    assertJsonSchemaValid(
      streamPayloadV2SchemaPath,
      baseJson.mapObject(
        _.add("byteLength", Json.fromString(OcrWorkerJobMessageV2.MaxByteLength.toString))
      ).noSpaces,
    )
    assertJsonSchemaInvalid(
      streamPayloadV2SchemaPath,
      baseJson.mapObject(
        _.add("byteLength", Json.fromString((OcrWorkerJobMessageV2.MaxByteLength + 1L).toString))
      ).noSpaces,
    )
  }

  test("bounds identifiers and request correlation fields") {
    assert(
      build(canonicalInput.copy(jobId = "x" * OcrWorkerJobMessageV2.MaxIdLength)).isRight
    )
    assert(
      build(
        canonicalInput.copy(jobId = "x" * (OcrWorkerJobMessageV2.MaxIdLength + 1))
      ).isLeft
    )
    assert(build(canonicalInput.copy(jobId = "job-日本語")).isLeft)
    assert(build(canonicalInput.copy(requestId = Some("bad value"))).isLeft)
  }

  test("JSON Schema rejects v1, local-path, and provider-bearing payload shapes") {
    val baseJson = OcrWorkerJobMessageV2.fieldsAsJson(canonicalPayload())

    List(
      baseJson.mapObject(_.add("schemaVersion", Json.fromString("1"))),
      baseJson.mapObject(_.add("imagePath", Json.fromString("/tmp/image.webp"))),
      baseJson.mapObject(_.add("bucket", Json.fromString("private-bucket"))),
      baseJson.mapObject(_.add("objectUrl", Json.fromString("https://example.invalid/image"))),
      baseJson.mapObject(_.add("byteLength", Json.fromLong(42L))),
    ).foreach(json => assertJsonSchemaInvalid(streamPayloadV2SchemaPath, json.noSpaces))
  }

  private final case class BuildInput(
      jobId: String,
      imageObjectKey: String,
      sha256: String,
      byteLength: Long,
      mediaType: String,
      requestedScreenType: ScreenType,
      attempt: Int,
      requestId: Option[String],
  )

  private def canonicalInput: BuildInput = BuildInput(
    jobId = "job-v2-1",
    imageObjectKey = "source-images/2026/image-v2-1.webp",
    sha256 = "ab" * 32,
    byteLength = OcrWorkerJobMessageV2.MaxByteLength,
    mediaType = "image/webp",
    requestedScreenType = ScreenType.IncidentLog,
    attempt = 1,
    requestId = Some("req_v2-1"),
  )

  private def canonicalPayload(): OcrWorkerJobMessageV2 =
    build(canonicalInput).fold(fail(_), identity)

  private def build(input: BuildInput): Either[String, OcrWorkerJobMessageV2] =
    OcrWorkerJobMessageV2.build(
    jobId = OcrJobId.unsafeFromString(input.jobId),
    draftId = OcrDraftId.unsafeFromString("draft-v2-1"),
    sourceImageId = ImageId.unsafeFromString("image-v2-1"),
    imageObjectKey = input.imageObjectKey,
    sha256 = input.sha256,
    byteLength = input.byteLength,
    mediaType = input.mediaType,
    requestedScreenType = input.requestedScreenType,
    attempt = input.attempt,
    enqueuedAt = Instant.parse("2026-08-11T00:00:00Z"),
    hints = OcrJobHints.empty,
    requestId = input.requestId,
  )
