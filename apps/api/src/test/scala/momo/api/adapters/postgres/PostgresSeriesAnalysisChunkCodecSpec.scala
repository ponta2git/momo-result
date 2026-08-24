package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.GameTitleId
import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisMatchContextExclusion,
  SeriesAnalysisScope
}
import momo.api.errors.AppError

final class PostgresSeriesAnalysisChunkCodecSpec extends FunSuite:
  private val gameTitleId = GameTitleId.unsafeFromString("title-chunk-codec")
  private val scope = SeriesAnalysisScope.Overall
  private val request = SeriesAnalysisChunkRequest(
    SeriesAnalysisChunkKind.Aggregate,
    gameTitleId,
    "artifact-chunk-codec",
    scope,
  )

  test("rejects malformed UTF-8 instead of decoding replacement characters"):
    val payload = aggregate("{\"note\":\"~\"}").getBytes(StandardCharsets.UTF_8)
    val markerIndex = payload.indexOf('~'.toByte)
    assert(markerIndex >= 0)
    payload(markerIndex) = 0x80.toByte

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = 3),
          request,
          SeriesAnalysisReadConfig.defaults,
          None
        ),
      "Invalid UTF-8 analysis artifact payload.",
    )

  test("rejects more than four distinct member identifiers before building a SQL IN clause"):
    val members = (1 to 5).map(index => s"{\"memberId\":\"member-$index\"}").mkString(",")
    val text = aggregate(s"{\"members\":[$members]}")
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        stored(payload, nestingDepth = 5),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      ),
      "Analysis artifact contains too many member identifiers.",
    )

  test("rejects a payload whose checksum differs from bounded metadata"):
    val payload = aggregate("{}").getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        storedWithChecksum(
          payload,
          nestingDepth = 3,
          checksum = "sha256:" + ("0" * 64),
        ),
        request,
        SeriesAnalysisReadConfig.defaults,
        None,
      ),
      "Invalid analysis artifact metadata.",
    )

  test("rejects a payload whose actual depth differs from bounded metadata"):
    val payload = aggregate("{\"nested\":{\"value\":1}}")
      .getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = 3),
          request,
          SeriesAnalysisReadConfig.defaults,
          None
        ),
      "Analysis artifact schema validation failed.",
    )

  test("pre-parse depth scan ignores structural characters inside JSON strings"):
    val text = aggregate("{\"note\":\"{{[[\\\"quoted\\\"]]}}\"}")
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertEquals(
      PostgresSeriesAnalysisChunkCodec
        .decode(stored(payload, nestingDepth = 3), request, SeriesAnalysisReadConfig.defaults, None)
        .map(_.payload),
      parse(text).left.map(error => fail(s"invalid test fixture: $error")),
    )

  test("rejects an isolated surrogate introduced by a JSON Unicode escape"):
    val isolatedSurrogateEscape = "\\u" + "D800"
    val text = aggregate(s"""{"note":"$isolatedSurrogateEscape"}""")
    val payload = text.getBytes(StandardCharsets.UTF_8)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec
        .decode(
          stored(payload, nestingDepth = 3),
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
    val payload = aggregate("{}").getBytes(StandardCharsets.UTF_8)
    assertInternal(
      PostgresSeriesAnalysisChunkCodec.decode(
        stored(payload, nestingDepth = 3),
        request,
        SeriesAnalysisReadConfig.defaults.copy(maxJsonNodes = 1),
        None,
      ),
      "Analysis artifact exceeds the JSON node bound.",
    )

  test("hydrates display metadata only when every referenced member is available"):
    val decoded = decodedAggregate().copy(memberIds = List("member-ponta"))
    val hydrated = PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
      decoded,
      Map("member-ponta" -> "ぽんた"),
      Some("総合"),
      SeriesAnalysisReadConfig.defaults,
    )

    assertEquals(
      hydrated.flatMap(chunk =>
        parsePayload(chunk.payload).map(_.hcursor.downField("scope").get[String]("displayName"))
      ),
      Right(Right("総合")),
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
      publishedAt = Instant.parse("2026-08-09T00:00:00Z"),
      scopeKind = Some(scope.kind),
      payload = Some(payload),
      encodedBytes = Some(payload.length),
      decodedBytes = Some(payload.length),
      itemCount = Some(0),
      nestingDepth = Some(nestingDepth),
      checksum = Some(checksum),
    )

  private def decodedAggregate() =
    val payload = aggregate("{}").getBytes(StandardCharsets.UTF_8)
    PostgresSeriesAnalysisChunkCodec
      .decode(stored(payload, nestingDepth = 3), request, SeriesAnalysisReadConfig.defaults, None)
      .fold(error => fail(s"invalid decoded aggregate fixture: $error"), identity)

  private def parsePayload(payload: Array[Byte]): Either[AppError, Json] =
    parse(new String(payload, StandardCharsets.UTF_8))
      .left.map(error => AppError.Internal(error.message))

  private def assertInternal[A](result: Either[AppError, A], expectedDetail: String): Unit =
    result match
      case Left(AppError.Internal(detail)) => assertEquals(detail, expectedDetail)
      case other => fail(s"expected Internal($expectedDetail), got $other")

  private def aggregate(summary: String): String =
    s"""{"schemaVersion":3,"scope":{"kind":"overall","matchCount":0},"players":[],"summary":$summary,"metricsByPlayer":[],"rankDistribution":[],"recentRanks":[],"strategyScatter":{},"playOrderComparison":[],"revenueRankConversion":[],"trends":[],"histograms":{},"headToHead":[],"momentumSwitch":{},"performanceProfiles":{},"assetStyleProfiles":{},"cardShopDestination":{},"matchDigest":[],"matchNoInEvent":[],"rankAnalysis":{},"highlights":[],"dataQuality":{},"metricDefinitions":[],"source":{}}"""

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"

end PostgresSeriesAnalysisChunkCodecSpec
