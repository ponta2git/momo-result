package momo.api.domain

import java.nio.file.Files

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.codec.OcrHintsCodec
import momo.api.testing.JsonSchemaAssertions

final class OcrLayoutFamilySpec extends FunSuite with JsonSchemaAssertions:
  private val fixture = parse(Files.readString(
    repositoryFile("docs/schemas/fixtures/ocr-worker/layout-families-v1.json")
  )).fold(error => fail(error.message), identity)

  test("shared legacy spellings resolve to the canonical layout without rewriting hints") {
    val accepted = fixture.hcursor.get[List[Json]]("accepted")
      .fold(error => fail(error.message), identity)
    accepted.foreach { entry =>
      val input = entry.hcursor.get[String]("input").fold(error => fail(error.message), identity)
      val canonical = entry.hcursor.get[String]("canonical")
        .fold(error => fail(error.message), identity)
      val hints = OcrJobHints.empty.copy(layoutFamily = Some(input))
      assertEquals(OcrLayoutFamily.fromLegacy(input).map(_.wire), Some(canonical))
      assertEquals(OcrHintsCodec.validate(hints), Right(()))
      val encoded = OcrHintsCodec.encode(hints)
      assertEquals(parse(encoded).flatMap(_.hcursor.get[String]("layoutFamily")), Right(input))
      assertJsonSchemaValid(ocrHintsSchemaPath, encoded)
    }
  }

  test("shared unsupported values fail fresh admission while absence permits automatic layout") {
    val rejected = fixture.hcursor.get[List[String]]("rejected")
      .fold(error => fail(error.message), identity)
    rejected.foreach { input =>
      val hints = OcrJobHints.empty.copy(layoutFamily = Some(input))
      assertEquals(OcrLayoutFamily.fromLegacy(input), None, clues(input))
      assert(OcrHintsCodec.validate(hints).isLeft, clues(input))
      assertJsonSchemaInvalid(ocrHintsSchemaPath, OcrHintsCodec.encode(hints))
    }
    assertEquals(OcrHintsCodec.validate(OcrJobHints.empty), Right(()))
    assertJsonSchemaValid(ocrHintsSchemaPath, OcrHintsCodec.encode(OcrJobHints.empty))
  }
