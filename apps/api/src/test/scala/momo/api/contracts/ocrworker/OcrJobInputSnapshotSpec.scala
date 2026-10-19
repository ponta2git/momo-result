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
    assertEquals(
      payload.fields.get(OcrJobInputSnapshot.HintsKey).map(parse),
      Some(parse("""{
        "gameTitle": "桃鉄2",
        "layoutFamily": "momotetsu_2",
        "knownPlayerAliases": [{"memberId": "member-ponta", "aliases": ["ぽんた", "PONTA"]}],
        "computerPlayerAliases": ["さくま"]
      }""")),
    )
    assert(!payload.fields.contains(OcrJobInputSnapshot.RequestIdKey))
  }

  test("accepts only explicit screen types") {
    val result = build(canonicalInput.copy(requestedScreenType = ScreenType.Auto))
    assertEquals(result, Left("requestedScreenType=auto is not supported by schemaVersion 2"))

    val autoJson = OcrJobInputSnapshot.toJson(canonicalPayload()).mapObject(
      _.add("requestedScreenType", Json.fromString("auto"))
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
