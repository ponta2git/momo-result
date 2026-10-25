package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

import com.networknt.schema.{InputFormat, SchemaRegistry, SpecificationVersion}
import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.contracts.seriesanalysis.{
  SeriesAnalysisArtifactContract,
  SeriesAnalysisResponseSchemas
}
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MemberId}
import momo.api.testing.JsonSchemaAssertions

final class PostgresSeriesAnalysisOutlookProjectionSpec extends FunSuite with JsonSchemaAssertions:
  private val config = SeriesAnalysisReadConfig.defaults
  private val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)

  test("summary includes the Rust-attested no-target shape and current display metadata"):
    List("outlook-summary-payload-v1.json", "outlook-summary-empty-payload-v1.json").foreach {
      file =>
        val payload = fixture(file)
        val decoded = decode(payload, SeriesAnalysisChunkKind.OutlookSummary)
        val _ = assertResponse(
          decoded,
          SeriesAnalysisChunkProjection.Stored,
          SeriesAnalysisResponseSchemas.outlookSummary
        )
        val wrongTitle = request(payload, SeriesAnalysisChunkKind.OutlookSummary)
          .copy(gameTitleId = GameTitleId.unsafeFromString("other-title"))
        assert(!SeriesAnalysisPayloadValidator.validate(
          payload,
          bytes(payload),
          wrongTitle,
          None,
          SeriesAnalysisArtifactContract.ArtifactSchemaVersion
        ))
    }

  test(
    "one stored member reference projects a requested window or normal insufficiency and examples"
  ):
    val payload = fixture("outlook-reference-payload-v1.json")
    val decoded = decode(payload, SeriesAnalysisChunkKind.OutlookReference)
    val total = payload.hcursor.downField("source").get[Int]("titleMatchCount").toOption.get
    val available = assertResponse(
      decoded,
      SeriesAnalysisChunkProjection.OutlookWindow(1),
      SeriesAnalysisResponseSchemas.outlookWindow
    )
    assertEquals(available.hcursor.get[String]("status"), Right("available"))
    assertEquals(available.hcursor.downField("window").get[Int]("windowSize"), Right(1))
    assert(!available.asObject.get.contains("bestWindows"))
    val insufficient = assertResponse(
      decoded,
      SeriesAnalysisChunkProjection.OutlookWindow(total + 1),
      SeriesAnalysisResponseSchemas.outlookWindow
    )
    assertEquals(insufficient.hcursor.get[String]("status"), Right("insufficient"))
    assertEquals(insufficient.hcursor.downField("window").focus, Some(Json.Null))
    val examples = assertResponse(
      decoded,
      SeriesAnalysisChunkProjection.OutlookExamples,
      SeriesAnalysisResponseSchemas.outlookExamples
    )
    assertEquals(
      examples.hcursor.downField("examples").focus,
      payload.hcursor.downField("examples").focus
    )
    assert(!examples.asObject.get.contains("recentRankCounts"))
    val missing = decoded.copy(payload = payload.mapObject(_.add("bestWindows", Json.arr())))
    assert(PostgresSeriesAnalysisOutlookProjection(
      missing,
      SeriesAnalysisChunkProjection.OutlookWindow(1)
    ).isLeft)
    val wrongMember = request(payload, SeriesAnalysisChunkKind.OutlookReference)
      .copy(memberId = Some(MemberId.unsafeFromString("other-member")))
    assert(!SeriesAnalysisPayloadValidator.validate(
      payload,
      bytes(payload),
      wrongMember,
      None,
      SeriesAnalysisArtifactContract.ArtifactSchemaVersion
    ))

  private def assertResponse(
      chunk: DecodedSeriesAnalysisChunk,
      projection: SeriesAnalysisChunkProjection,
      resource: SeriesAnalysisResponseSchemas.Resource,
  ): Json =
    val projected = PostgresSeriesAnalysisOutlookProjection(chunk, projection)
      .fold(error => fail(error.toString), identity)
    val rendered = PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
      projected,
      chunk.memberIds.map(_ -> "現在の名前").toMap,
      Some("総合"),
      config,
      Map.empty
    )
      .fold(error => fail(error.toString), identity)
    val json = parse(new String(rendered.payload, StandardCharsets.UTF_8))
      .fold(error => fail(error.toString), identity)
    val schema = registry.getSchema(
      SeriesAnalysisResponseSchemas.schemaFor(resource).noSpaces,
      InputFormat.JSON
    )
    assert(schema.validate(json.noSpaces, InputFormat.JSON).isEmpty)
    assertEquals(
      json.hcursor.downField("artifact").get[String]("artifactId"),
      Right("artifact-outlook")
    )
    assertEquals(json.hcursor.downField("scope").get[String]("displayName"), Right("総合"))
    json

  private def request(payload: Json, kind: SeriesAnalysisChunkKind): SeriesAnalysisChunkRequest =
    SeriesAnalysisChunkRequest(
      kind,
      GameTitleId.unsafeFromString(
        payload.hcursor.downField("source").get[String]("gameTitleId").toOption.get
      ),
      "artifact-outlook",
      SeriesAnalysisScope.Overall,
      memberId = payload.hcursor.get[String]("memberId").toOption.map(MemberId.unsafeFromString)
    )

  private def decode(payload: Json, kind: SeriesAnalysisChunkKind): DecodedSeriesAnalysisChunk =
    val encoded = bytes(payload)
    val read = request(payload, kind)
    val checksum =
      MessageDigest.getInstance("SHA-256").digest(encoded).map(b => f"${b & 0xff}%02x").mkString
    val row = SeriesAnalysisStoredChunk(
      "artifact-outlook",
      read.gameTitleId,
      1,
      "series-analysis-v11",
      SeriesAnalysisArtifactContract.ArtifactSchemaVersion,
      Some(SeriesAnalysisArtifactContract.ValidationContractId),
      Instant.parse("2026-01-01T00:00:00Z"),
      Some("overall"),
      Some(encoded),
      Some(encoded.length),
      Some(encoded.length),
      Some(1),
      Some(depth(payload)),
      Some(s"sha256:$checksum")
    )
    PostgresSeriesAnalysisChunkCodec.decode(row, read, config, None)
      .fold(error => fail(error.toString), identity)

  private def fixture(name: String): Json = parse(Files.readString(repositoryFile(
    s"docs/schemas/fixtures/series-analysis/$name"
  ))).fold(error => fail(error.toString), identity)
  private def bytes(payload: Json): Array[Byte] = payload.noSpaces.getBytes(StandardCharsets.UTF_8)
  private def depth(value: Json): Int = value.arrayOrObject(
    1,
    values => 1 + values.map(depth).maxOption.getOrElse(0),
    fields => 1 + fields.values.map(depth).maxOption.getOrElse(0)
  )
