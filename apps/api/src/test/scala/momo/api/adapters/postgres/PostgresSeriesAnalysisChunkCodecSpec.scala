package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.GameTitleId
import momo.api.domain.{SeriesAnalysisChunkKind, SeriesAnalysisChunkRequest, SeriesAnalysisScope}
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
    val json = Json.arr((1 to 5).map(index =>
      Json.obj(
        "memberId" -> Json.fromString(s"member-$index")
      )
    )*)

    assertInternal(
      PostgresSeriesAnalysisChunkCodec.memberIds(json),
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

  test("counts exact UTF-8 response bytes for BMP and supplementary characters"):
    assertEquals(
      PostgresSeriesAnalysisChunkCodec.jsonUtf8BytesUpperBound(Json.fromString("aあ😀")),
      10L,
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
      artifactSchemaVersion = 1,
      publishedAt = Instant.parse("2026-08-09T00:00:00Z"),
      scopeKind = Some(scope.kind),
      payload = Some(payload),
      encodedBytes = Some(payload.length),
      decodedBytes = Some(payload.length),
      itemCount = Some(0),
      nestingDepth = Some(nestingDepth),
      checksum = Some(checksum),
    )

  private def assertInternal[A](result: Either[AppError, A], expectedDetail: String): Unit =
    result match
      case Left(AppError.Internal(detail)) => assertEquals(detail, expectedDetail)
      case other => fail(s"expected Internal($expectedDetail), got $other")

  private def aggregate(summary: String): String =
    s"""{"schemaVersion":2,"scope":{"kind":"overall","matchCount":0},"players":[],"summary":$summary,"metricsByPlayer":[],"rankDistribution":[],"recentRanks":[],"strategyScatter":{},"playOrderComparison":[],"revenueRankConversion":[],"trends":[],"histograms":{},"headToHead":[],"momentumSwitch":{},"performanceProfiles":{},"assetStyleProfiles":{},"cardShopDestination":{},"matchDigest":[],"matchNoInEvent":[],"rankAnalysis":{},"highlights":[],"dataQuality":{},"metricDefinitions":[],"source":{}}"""

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"

end PostgresSeriesAnalysisChunkCodecSpec
