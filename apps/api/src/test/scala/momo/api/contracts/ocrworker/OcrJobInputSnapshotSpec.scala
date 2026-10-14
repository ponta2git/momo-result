package momo.api.contracts.ocrworker

import java.nio.file.Files

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, PlayerAliasHint, ScreenType}
import momo.api.testing.JsonSchemaAssertions

final class OcrJobInputSnapshotSpec extends FunSuite with JsonSchemaAssertions:
  test("Scala producer matches the shared Rust consumer fixture") {
    val fixture = Files.readString(
      repositoryFile("docs/schemas/fixtures/ocr-worker/valid-job-input-v2.json")
    )
    val fixtureJson = parse(fixture).fold(error => fail(error.message), identity)

    assertEquals(OcrJobInputSnapshot.toJson(canonicalPayload()), fixtureJson)
    assertOcrJobInputSnapshotSchemaValid(fixtureJson)
  }

  test("builds the exact closed OCR job input snapshot") {
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
        "requestId" -> "req_v2-1",
      ),
    )
    assertOcrJobInputSnapshotSchemaValid(payload)
  }

  test("round-trips a typed payload and rejects non-string or unknown fields") {
    val payload = canonicalPayload()
    val json = OcrJobInputSnapshot.toJson(payload)

    assertEquals(OcrJobInputSnapshot.fromJson(json).map(_.fields), Right(payload.fields))
    assertEquals(
      OcrJobInputSnapshot.fromJson(json.mapObject(_.add("byteLength", Json.fromInt(1)))),
      Left("field byteLength must be a string"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(json.mapObject(_.add("bucketUrl", Json.fromString("x")))),
      Left("unknown input snapshot field(s): bucketUrl"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(json.mapObject(_.add("imagePath", Json.fromString("/tmp/x")))),
      Left("unknown input snapshot field(s): imagePath"),
    )
  }

  test("serializes bounded hints and omits an absent request id") {
    val hints = OcrJobHints(
      gameTitle = Some("桃鉄2"),
      layoutFamily = Some("momotetsu_2"),
      knownPlayerAliases = List(
        PlayerAliasHint(MemberId.unsafeFromString("member-ponta"), List("ぽんた", "PONTA"))
      ),
      computerPlayerAliases = List("さくま"),
    )
    val payload =
      build(canonicalInput.copy(hints = hints, requestId = None)).fold(fail(_), identity)

    assertOcrJobInputSnapshotSchemaValid(payload)
    assert(payload.fields.contains(OcrJobInputSnapshot.HintsKey))
    assert(!payload.fields.contains(OcrJobInputSnapshot.RequestIdKey))
    assertEquals(
      OcrJobInputSnapshot.fromJson(OcrJobInputSnapshot.toJson(payload)).map(_.fields),
      Right(payload.fields),
    )
  }

  test("rejects malformed input snapshot fields") {
    val base = OcrJobInputSnapshot.toJson(canonicalPayload())
    def replace(key: String, value: Json): Json = base.mapObject(_.add(key, value))

    assertEquals(
      OcrJobInputSnapshot.fromJson(Json.fromString("not-an-object")),
      Left("input snapshot must be a JSON object"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(base.mapObject(_.remove("jobId"))),
      Left("field jobId must be a string"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(replace("schemaVersion", Json.fromString("3"))),
      Left("schemaVersion must be 2"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(replace("byteLength", Json.fromString("3MiB"))),
      Left("byteLength must be an integer string"),
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(replace(OcrJobInputSnapshot.HintsKey, Json.fromInt(1))),
      Left("field ocrHintsJson must be a string"),
    )
    assert(
      OcrJobInputSnapshot
        .fromJson(replace(OcrJobInputSnapshot.HintsKey, Json.fromString("{")))
        .left.exists(_.nonEmpty)
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(replace(OcrJobInputSnapshot.RequestIdKey, Json.fromInt(1))),
      Left("field requestId must be a string"),
    )
  }

  test("accepts only explicit screen types") {
    val result = build(canonicalInput.copy(requestedScreenType = ScreenType.Auto))
    assertEquals(result, Left("requestedScreenType=auto is not supported by schemaVersion 2"))

    val autoJson = OcrJobInputSnapshot.toJson(canonicalPayload()).mapObject(
      _.add("requestedScreenType", Json.fromString("auto"))
    )
    assertEquals(
      OcrJobInputSnapshot.fromJson(autoJson),
      Left("unknown requestedScreenType=auto"),
    )
    assertJsonSchemaInvalid(ocrJobInputSchemaPath, autoJson.noSpaces)
  }

  test("rejects URL-like, absolute, ambiguous, or unsafe object keys") {
    val canonicalJson = OcrJobInputSnapshot.toJson(canonicalPayload())
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
      assertJsonSchemaInvalid(
        ocrJobInputSchemaPath,
        canonicalJson.mapObject(_.add("imageObjectKey", Json.fromString(key))).noSpaces,
      )
    }
  }

  test("enforces verified image metadata and the exact 3 MiB boundary") {
    assert(build(canonicalInput.copy(byteLength = 1L)).isRight)
    assert(build(canonicalInput.copy(byteLength = OcrJobInputSnapshot.MaxByteLength)).isRight)
    assert(build(canonicalInput.copy(byteLength = 0L)).isLeft)
    assert(
      build(canonicalInput.copy(byteLength = OcrJobInputSnapshot.MaxByteLength + 1L)).isLeft
    )
    assert(build(canonicalInput.copy(sha256 = "AB" * 32)).isLeft)
    assert(build(canonicalInput.copy(sha256 = "a" * 63)).isLeft)
    assert(build(canonicalInput.copy(mediaType = "image/gif")).isLeft)

    val baseJson = OcrJobInputSnapshot.toJson(canonicalPayload())
    assertJsonSchemaValid(
      ocrJobInputSchemaPath,
      baseJson.mapObject(
        _.add("byteLength", Json.fromString(OcrJobInputSnapshot.MaxByteLength.toString))
      ).noSpaces,
    )
    assertJsonSchemaInvalid(
      ocrJobInputSchemaPath,
      baseJson.mapObject(
        _.add("byteLength", Json.fromString((OcrJobInputSnapshot.MaxByteLength + 1L).toString))
      ).noSpaces,
    )
  }

  test("bounds identifiers and request correlation fields") {
    assert(
      build(canonicalInput.copy(jobId = "x" * OcrJobInputSnapshot.MaxIdLength)).isRight
    )
    assert(
      build(
        canonicalInput.copy(jobId = "x" * (OcrJobInputSnapshot.MaxIdLength + 1))
      ).isLeft
    )
    assert(build(canonicalInput.copy(jobId = "job-日本語")).isLeft)
    assert(build(canonicalInput.copy(requestId = Some("bad value"))).isLeft)
  }

  test("rejects semantically invalid and oversized hint payloads") {
    val invalid = OcrJobHints.empty.copy(gameTitle = Some(""))
    assert(build(canonicalInput.copy(hints = invalid)).isLeft)

    val wide = "桃" * OcrJobHints.MaxAliasLength
    val oversized = OcrJobHints(
      gameTitle = Some(wide),
      layoutFamily = Some(wide),
      knownPlayerAliases = List.tabulate(OcrJobHints.MaxKnownPlayerAliases) { index =>
        PlayerAliasHint(
          MemberId.unsafeFromString(s"member-$index-${"x" * 100}"),
          List.fill(OcrJobHints.MaxAliasesPerPlayer)(wide),
        )
      },
      computerPlayerAliases = List.fill(OcrJobHints.MaxComputerPlayerAliases)(wide),
    )
    assertEquals(
      build(canonicalInput.copy(hints = oversized)),
      Left(
        s"ocrHintsJson must be ${OcrJobInputSnapshot.MaxHintsUtf8Bytes} UTF-8 bytes or shorter"
      ),
    )
  }

  test("JSON Schema rejects v1, local-path, and provider-bearing payload shapes") {
    val baseJson = OcrJobInputSnapshot.toJson(canonicalPayload())

    List(
      baseJson.mapObject(_.add("schemaVersion", Json.fromString("1"))),
      baseJson.mapObject(_.add("imagePath", Json.fromString("/tmp/image.webp"))),
      baseJson.mapObject(_.add("bucket", Json.fromString("private-bucket"))),
      baseJson.mapObject(_.add("objectUrl", Json.fromString("https://example.invalid/image"))),
      baseJson.mapObject(_.add("byteLength", Json.fromLong(42L))),
      baseJson.mapObject(_.add("attempt", Json.fromString("1"))),
      baseJson.mapObject(_.add("enqueuedAt", Json.fromString("2026-08-11T00:00:00Z"))),
    ).foreach(json => assertJsonSchemaInvalid(ocrJobInputSchemaPath, json.noSpaces))
  }

  private final case class BuildInput(
      jobId: String,
      imageObjectKey: String,
      sha256: String,
      byteLength: Long,
      mediaType: String,
      requestedScreenType: ScreenType,
      hints: OcrJobHints,
      requestId: Option[String],
  )

  private def canonicalInput: BuildInput = BuildInput(
    jobId = "job-v2-1",
    imageObjectKey = "source-images/2026/image-v2-1.webp",
    sha256 = "ab" * 32,
    byteLength = OcrJobInputSnapshot.MaxByteLength,
    mediaType = "image/webp",
    requestedScreenType = ScreenType.IncidentLog,
    hints = OcrJobHints.empty,
    requestId = Some("req_v2-1"),
  )

  private def canonicalPayload(): OcrJobInputSnapshot =
    build(canonicalInput).fold(fail(_), identity)

  private def build(input: BuildInput): Either[String, OcrJobInputSnapshot] =
    OcrJobInputSnapshot.build(
      jobId = OcrJobId.unsafeFromString(input.jobId),
      draftId = OcrDraftId.unsafeFromString("draft-v2-1"),
      sourceImageId = ImageId.unsafeFromString("image-v2-1"),
      imageObjectKey = input.imageObjectKey,
      sha256 = input.sha256,
      byteLength = input.byteLength,
      mediaType = input.mediaType,
      requestedScreenType = input.requestedScreenType,
      hints = input.hints,
      requestId = input.requestId,
    )
