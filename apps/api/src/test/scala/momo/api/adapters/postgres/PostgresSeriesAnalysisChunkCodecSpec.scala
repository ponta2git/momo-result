package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.contracts.seriesanalysis.SeriesAnalysisResponseSchemas
import momo.api.domain.ids.{GameTitleId, MatchId, MemberId}
import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisMatchContextExclusion,
  SeriesAnalysisScope
}
import momo.api.errors.AppError
import momo.api.testing.JsonSchemaAssertions

final class PostgresSeriesAnalysisChunkCodecSpec extends FunSuite with JsonSchemaAssertions:
  private val gameTitleId = GameTitleId.unsafeFromString("title-chunk-codec")
  private val scope = SeriesAnalysisScope.Overall
  private val request = SeriesAnalysisChunkRequest(
    SeriesAnalysisChunkKind.Aggregate,
    gameTitleId,
    "artifact-chunk-codec",
    scope,
  )

  test("rejects malformed UTF-8 instead of decoding replacement characters"):
    val payload = aggregateFixture.replace("title-fixture", "~").getBytes(StandardCharsets.UTF_8)
    val markerIndex = payload.indexOf('~'.toByte)
    assert(markerIndex >= 0)
    payload(markerIndex) = 0x80.toByte

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = nestingDepth(aggregateFixture)),
          request,
          SeriesAnalysisReadConfig.defaults,
          None
        ),
      "Invalid UTF-8 analysis artifact payload.",
    )

  test("rejects more than four distinct member identifiers before building a SQL IN clause"):
    val members = (1 to 5).map(index => s"{\"memberId\":\"member-$index\"}").mkString(",")
    val text = s"{\"members\":[$members]}"
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        stored(payload, nestingDepth = nestingDepth(text)),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      ),
      "Analysis artifact contains too many member identifiers.",
    )

  test("rejects a payload whose checksum differs from bounded metadata"):
    val payload = aggregateFixture.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        storedWithChecksum(
          payload,
          nestingDepth = nestingDepth(aggregateFixture),
          checksum = "sha256:" + ("0" * 64),
        ),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      ),
      "Invalid analysis artifact metadata.",
    )

  test("requires the exact immutable Rust publication attestation"):
    val payload = aggregateFixture.getBytes(StandardCharsets.UTF_8)
    val row = stored(payload, nestingDepth = nestingDepth(aggregateFixture))

    List(None, Some("unknown-validation-contract")).foreach { contract =>
      assertInternal(
        PostgresSeriesAnalysisChunkCodec.decode(
          row.copy(validationContractId = contract),
          request,
          SeriesAnalysisReadConfig.defaults,
          None,
        ),
        "Invalid analysis artifact metadata.",
      )
    }
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        row.copy(artifactSchemaVersion = 1),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      ),
      "Invalid analysis artifact metadata.",
    )

  test("rejects a payload whose actual depth differs from bounded metadata"):
    val payload = aggregateFixture.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = nestingDepth(aggregateFixture) - 1),
          request,
          SeriesAnalysisReadConfig.defaults,
          None
        ),
      "Analysis artifact schema validation failed.",
    )

  test("pre-parse depth scan ignores structural characters inside JSON strings"):
    val text = parse(aggregateFixture)
      .fold(error => fail(s"invalid aggregate fixture: $error"), identity)
      .hcursor.downField("source")
      .downField("gameTitleId")
      .withFocus(_ => Json.fromString("{{[[\"quoted\"]]}}"))
      .top.getOrElse(fail("failed to update source gameTitleId"))
      .noSpaces
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertEquals(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = nestingDepth(text)),
          request,
          SeriesAnalysisReadConfig.defaults,
          None,
        )
        .map(_.payload),
      parse(text).left.map(error => fail(s"invalid test fixture: $error")),
    )

  test("rejects an isolated surrogate introduced by a JSON Unicode escape"):
    val isolatedSurrogateEscape = "\\u" + "D800"
    val text = aggregateFixture.replace("title-fixture", isolatedSurrogateEscape)
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = nestingDepth(aggregateFixture)),
          request,
          SeriesAnalysisReadConfig.defaults,
          None
        ),
      "Analysis artifact contains invalid Unicode.",
    )

  test("renders exact UTF-8 response bytes without a full JSON String"):
    assertEquals(
      PostgresSeriesAnalysisChunkCodec
        .renderJson(Json.fromString("aあ😀"), maximumBytes = 10)
        .map(_.toList),
      Right(Json.fromString("aあ😀").noSpaces.getBytes(StandardCharsets.UTF_8).toList),
    )

  test("byte rendering matches the JDK UTF-8 replacement for an isolated surrogate"):
    val isolatedSurrogate = Character.toString(0xd800.toChar)
    val json = Json.fromString(isolatedSurrogate)

    assertEquals(
      PostgresSeriesAnalysisChunkCodec
        .renderJson(json, maximumBytes = 3)
        .map(_.toList),
      Right(json.noSpaces.getBytes(StandardCharsets.UTF_8).toList),
    )

  test("rejects a decoded tree above the configured JSON node bound"):
    val payload = aggregateFixture.getBytes(StandardCharsets.UTF_8)
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        stored(payload, nestingDepth = nestingDepth(aggregateFixture)),
        request,
        SeriesAnalysisReadConfig.defaults.copy(maxJsonNodes = 1),
        None,
      ),
      "Analysis artifact exceeds the JSON node bound.",
    )

  test("hydrates display metadata only when every referenced member is available"):
    val decoded = decodedAggregate().copy(
      payload = Json.obj(
        "player" -> Json.obj("memberId" -> Json.fromString("member-ponta")),
        "scope" -> Json.obj(
          "kind" -> Json.fromString("overall"),
          "matchCount" -> Json.fromInt(0),
        ),
      ),
      memberIds = List("member-ponta"),
    )
    val hydrated = PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
      decoded,
      Map("member-ponta" -> "ぽんた"),
      Some("総合"),
      SeriesAnalysisReadConfig.defaults,
    )

    assertEquals(
      hydrated.flatMap(chunk =>
        parsePayload(chunk.payload).map(payload =>
          (
            payload.hcursor.downField("scope").get[String]("displayName"),
            payload.hcursor.downField("player").get[String]("displayName"),
          )
        )
      ),
      Right((Right("総合"), Right("ぽんた"))),
    )
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
        decoded,
        Map.empty,
        Some("総合"),
        SeriesAnalysisReadConfig.defaults,
      ),
      "Analysis display metadata is unavailable.",
    )
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
        decoded,
        Map("member-ponta" -> ""),
        Some("総合"),
        SeriesAnalysisReadConfig.defaults,
      ),
      "Analysis display metadata is unavailable.",
    )
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
        decoded,
        Map("member-ponta" -> "ぽんた"),
        Some(""),
        SeriesAnalysisReadConfig.defaults,
      ),
      "Analysis display metadata is unavailable.",
    )

  test("applies the response byte bound after display metadata hydration"):
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
        decodedAggregate(),
        Map.empty,
        Some("総合"),
        SeriesAnalysisReadConfig.defaults.copy(maxResponseBytes = 1),
      ),
      "Analysis response exceeds the configured bound.",
    )

  test("match context exclusion reasons form a closed stable wire contract"):
    assertEquals(
      SeriesAnalysisMatchContextExclusion.values.map(_.wire).toList,
      List("match_changed_since_artifact", "not_in_artifact", "not_in_scope"),
    )

  test("moves the included match revision into the public inclusion envelope"):
    val original = DecodedSeriesAnalysisChunk(
      artifact = artifact,
      scope = scope,
      payload = Json.obj(
        "schemaVersion" -> Json.fromInt(1),
        "sourceMatchRevision" -> Json.fromString("7"),
      ),
      memberIds = Nil,
      nodeCount = 3,
    )

    val included = PostgresSeriesAnalysisChunkCodec.includedContext(original, 7)

    assertEquals(included.payload.hcursor.get[String]("sourceMatchRevision").toOption, None)
    assertEquals(
      included.payload.hcursor.downField("inclusion").get[String]("sourceMatchRevision"),
      Right("7"),
    )
    assertEquals(included.nodeCount, 5)

  test("rendered artifact responses satisfy the API-owned schemas"):
    assertHydratedFixture(
      "aggregate-payload-v3.json",
      SeriesAnalysisResponseSchemas.aggregate,
      request,
      itemCount = 0,
      sourceMatchRevision = None,
    )
    assertHydratedFixture(
      "review-payload-v3.json",
      SeriesAnalysisResponseSchemas.review,
      request.copy(kind = SeriesAnalysisChunkKind.Review),
      itemCount = 1,
      sourceMatchRevision = None,
    )
    assertHydratedFixture(
      "drilldown-payload-v3.json",
      SeriesAnalysisResponseSchemas.drilldown,
      request.copy(
        kind = SeriesAnalysisChunkKind.Drilldown,
        memberId = Some(MemberId.unsafeFromString("member-1")),
        metric = Some(SeriesAnalysisDrilldownMetric.RankAverageHistory),
      ),
      itemCount = 1,
      sourceMatchRevision = None,
    )
    assertHydratedFixture(
      "match-context-payload-v1.json",
      SeriesAnalysisResponseSchemas.matchContext,
      request.copy(
        kind = SeriesAnalysisChunkKind.MatchContext,
        matchId = Some(MatchId.unsafeFromString("match-1")),
      ),
      itemCount = 1,
      sourceMatchRevision = Some(1),
    )

    val excluded = PostgresSeriesAnalysisChunkCodec.excludedContext(
      artifact,
      scope,
      MatchId.unsafeFromString("match-1"),
      SeriesAnalysisMatchContextExclusion.NotInScope,
    )
    val rendered = PostgresSeriesAnalysisChunkCodec
      .hydrateAndRender(excluded, Map.empty, Some("総合"), SeriesAnalysisReadConfig.defaults)
      .fold(error => fail(s"failed to render excluded context: $error"), identity)
    assertInlineJsonSchemaValid(
      SeriesAnalysisResponseSchemas.matchContext.componentName,
      responseSchema(SeriesAnalysisResponseSchemas.matchContext).noSpaces,
      new String(rendered.payload, StandardCharsets.UTF_8),
    )

  private def stored(
      payload: Array[Byte],
      nestingDepth: Int,
  ): SeriesAnalysisStoredChunk = storedWithChecksum(payload, nestingDepth, sha256(payload))

  private def storedWithChecksum(
      payload: Array[Byte],
      nestingDepth: Int,
      checksum: String,
  ): SeriesAnalysisStoredChunk =
    SeriesAnalysisStoredChunk(
      artifactId = request.artifactId,
      artifactGameTitleId = gameTitleId,
      inputRevision = 0,
      algorithmVersion = "series-analysis-v1",
      artifactSchemaVersion = 2,
      validationContractId = Some(SeriesAnalysisArtifactSupport.ValidationContractId),
      publishedAt = Instant.parse("2026-08-09T00:00:00Z"),
      scopeKind = Some(scope.kind),
      payload = Some(payload),
      encodedBytes = Some(payload.length),
      decodedBytes = Some(payload.length),
      itemCount = Some(0),
      nestingDepth = Some(nestingDepth),
      checksum = Some(checksum),
    )

  private def artifact = momo.api.domain.SeriesAnalysisArtifactRef(
    request.artifactId,
    gameTitleId,
    0,
    "series-analysis-v1",
    2,
    Instant.parse("2026-08-09T00:00:00Z"),
  )

  private def decodedAggregate() =
    val payload = aggregateFixture.getBytes(StandardCharsets.UTF_8)
    PostgresSeriesAnalysisChunkCodec
      .decode(
        stored(payload, nestingDepth = nestingDepth(aggregateFixture)),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      )
      .fold(error => fail(s"invalid decoded aggregate fixture: $error"), identity)

  private def assertHydratedFixture(
      fixtureName: String,
      resource: SeriesAnalysisResponseSchemas.Resource,
      fixtureRequest: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
  ): Unit =
    val text = Files.readString(
      repositoryFile(s"docs/schemas/fixtures/series-analysis/$fixtureName")
    )
    val payload = text.getBytes(StandardCharsets.UTF_8)
    val row = stored(payload, nestingDepth(text)).copy(itemCount = Some(itemCount))
    val decoded = PostgresSeriesAnalysisChunkCodec
      .decode(
        row,
        fixtureRequest,
        SeriesAnalysisReadConfig.defaults,
        sourceMatchRevision,
      )
      .fold(error => fail(s"failed to decode $fixtureName: $error"), identity)
    val publicChunk = sourceMatchRevision.fold(decoded)(revision =>
      PostgresSeriesAnalysisChunkCodec.includedContext(decoded, revision)
    )
    val memberNames = publicChunk.memberIds.map(id => id -> s"name-$id").toMap
    val rendered = PostgresSeriesAnalysisChunkCodec
      .hydrateAndRender(
        publicChunk,
        memberNames,
        Some("総合"),
        SeriesAnalysisReadConfig.defaults,
      )
      .fold(error => fail(s"failed to hydrate $fixtureName: $error"), identity)
    assertInlineJsonSchemaValid(
      resource.componentName,
      responseSchema(resource).noSpaces,
      new String(rendered.payload, StandardCharsets.UTF_8),
    )

  private def responseSchema(resource: SeriesAnalysisResponseSchemas.Resource): Json =
    SeriesAnalysisResponseSchemas.schemaFor(resource)

  private def parsePayload(payload: Array[Byte]): Either[AppError, Json] =
    parse(new String(payload, StandardCharsets.UTF_8))
      .left.map(error => AppError.Internal(error.message))

  private def assertInternal[A](result: Either[AppError, A], expectedDetail: String): Unit =
    result match
      case Left(AppError.Internal(detail)) => assertEquals(detail, expectedDetail)
      case other => fail(s"expected Internal($expectedDetail), got $other")

  private lazy val aggregateFixture =
    Files.readString(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json")
    )

  private def nestingDepth(text: String): Int =
    def loop(value: Json): Int = value.arrayOrObject(
      1,
      values => 1 + values.map(loop).maxOption.getOrElse(0),
      fields => 1 + fields.values.map(loop).maxOption.getOrElse(0),
    )
    parse(text).fold(error => fail(s"invalid JSON fixture: $error"), loop)

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"

end PostgresSeriesAnalysisChunkCodecSpec
