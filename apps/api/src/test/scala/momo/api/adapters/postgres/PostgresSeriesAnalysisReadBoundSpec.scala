package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.syntax.all.*
import munit.CatsEffectSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.ids.GameTitleId
import momo.api.domain.{
  SeriesAnalysisChunk,
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisScope
}
import momo.api.errors.AppError

final class PostgresSeriesAnalysisReadBoundSpec extends CatsEffectSuite:
  private val gameTitleId = GameTitleId.unsafeFromString("title-read-bound")
  private val scope = SeriesAnalysisScope.Overall
  private val request = SeriesAnalysisChunkRequest(
    SeriesAnalysisChunkKind.Aggregate,
    gameTitleId,
    "artifact-read-bound",
    scope,
  )
  private val AggregatePrefix =
    """{"schemaVersion":3,"scope":{"kind":"overall","matchCount":0},"players":[],"summary":"""
  private val AggregateSuffix =
    ""","metricsByPlayer":[],"rankDistribution":[],"recentRanks":[],"strategyScatter":{},"playOrderComparison":[],"revenueRankConversion":[],"trends":[],"histograms":{},"headToHead":[],"momentumSwitch":{},"performanceProfiles":{},"assetStyleProfiles":{},"cardShopDestination":{},"matchDigest":[],"matchNoInEvent":[],"rankAnalysis":{},"highlights":[],"dataQuality":{},"metricDefinitions":[],"source":{}}"""

  test("timed out reads return a retryable error and release the decode permit"):
    val config = SeriesAnalysisReadConfig.defaults.copy(
      readTimeout = scala.concurrent.duration.DurationInt(1).millis
    )
    for
      semaphore <- Semaphore[IO](1)
      timedOut <- PostgresSeriesAnalysisRepository.boundedChunkRead(semaphore, config)(
        IO.never[Either[AppError, SeriesAnalysisChunk]]
      )
      permitAfterTimeout <- semaphore.tryAcquire
      _ <- semaphore.release.whenA(permitAfterTimeout)
    yield
      assertEquals(
        timedOut,
        Left(AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)),
      )
      assertEquals(permitAfterTimeout, true)

  test("a saturated decode semaphore fails without starting the read"):
    val config = SeriesAnalysisReadConfig.defaults
    for
      semaphore <- Semaphore[IO](0)
      started <- cats.effect.Ref.of[IO, Boolean](false)
      result <- PostgresSeriesAnalysisRepository.boundedChunkRead(semaphore, config)(
        started.set(true) *> IO.raiseError[Either[AppError, SeriesAnalysisChunk]](
          new IllegalStateException("saturated reads must not start")
        )
      )
      wasStarted <- started.get
    yield
      assertEquals(
        result,
        Left(AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)),
      )
      assertEquals(wasStarted, false)

  test("maximum accepted fixture materializes at the configured concurrency"):
    val config = SeriesAnalysisReadConfig.defaults
    for
      payload <- IO.blocking(maximumAcceptedPayload(config))
      results <- List.range(0, config.decodeConcurrency).parTraverse(_ =>
        IO.blocking {
          val privatePayload = payload.clone()
          PostgresSeriesAnalysisChunkCodec
            .decode(stored(privatePayload, nestingDepth = 4), request, config, None)
            .flatMap(decoded =>
              Either.cond(
                decoded.nodeCount == config.maxJsonNodes,
                decoded,
                AppError.Internal("maximum fixture did not reach the JSON node bound."),
              )
            )
            .flatMap(decoded =>
              PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
                decoded,
                Map.empty,
                Some("総合"),
                config,
              )
            )
        }
      )
    yield
      assertEquals(results.size, config.decodeConcurrency)
      assert(config.maxEncodedBytes - payload.length.toLong <= 4096L)
      results.foreach {
        case Right(chunk) => assertEquals(chunk.payload.length.toLong, config.maxResponseBytes)
        case Left(error) => fail(s"maximum concurrent materialization failed: $error")
      }

  private def maximumAcceptedPayload(config: SeriesAnalysisReadConfig): Array[Byte] =
    val emptyPayload = aggregate("""{"nodes":[],"padding":""}""")
      .getBytes(StandardCharsets.UTF_8)
    val baseNodeCount = PostgresSeriesAnalysisChunkCodec
      .decode(stored(emptyPayload, nestingDepth = 3), request, config, None)
      .fold(error => fail(s"invalid empty maximum fixture: $error"), _.nodeCount)
    val scalarNodeCount = config.maxJsonNodes - baseNodeCount
    assert(scalarNodeCount > 0)

    val unpadded = aggregateWithScalarNodes(scalarNodeCount, targetBytes = 0)
    val preliminary = PostgresSeriesAnalysisChunkCodec
      .decode(stored(unpadded, nestingDepth = 4), request, config, None)
      .flatMap(decoded =>
        PostgresSeriesAnalysisChunkCodec.hydrateAndRender(
          decoded,
          Map.empty,
          Some("総合"),
          config.copy(maxResponseBytes = Long.MaxValue),
        )
      )
      .fold(error => fail(s"invalid unpadded maximum fixture: $error"), identity)
    val responseOverhead = preliminary.payload.length - unpadded.length
    assert(responseOverhead > 0)
    val targetBytes = math.min(
      config.maxEncodedBytes,
      config.maxResponseBytes - responseOverhead.toLong,
    ).toInt

    aggregateWithScalarNodes(scalarNodeCount, targetBytes)

  private def aggregateWithScalarNodes(
      scalarNodeCount: Int,
      targetBytes: Int,
  ): Array[Byte] =
    // A fixed array avoids constructing another maximum-size String just to create the fixture.
    // scalafix:off DisableSyntax.var
    val prefix = (AggregatePrefix + """{"nodes":[""").getBytes(StandardCharsets.UTF_8)
    val paddingPrefix = "],\"padding\":\"".getBytes(StandardCharsets.UTF_8)
    val suffix = ("\"}" + AggregateSuffix).getBytes(StandardCharsets.UTF_8)
    val scalarBytes = scalarNodeCount * 2 - 1
    val fixedBytes = prefix.length + scalarBytes + paddingPrefix.length + suffix.length
    val actualTarget = if targetBytes == 0 then fixedBytes else targetBytes
    val paddingBytes = actualTarget - fixedBytes
    assert(paddingBytes >= 0)

    val payload = new Array[Byte](actualTarget)
    System.arraycopy(prefix, 0, payload, 0, prefix.length)
    var offset = prefix.length
    var index = 0
    while index < scalarNodeCount do
      if index > 0 then
        payload(offset) = ','.toByte
        offset += 1
      payload(offset) = '0'.toByte
      offset += 1
      index += 1
    System.arraycopy(paddingPrefix, 0, payload, offset, paddingPrefix.length)
    offset += paddingPrefix.length
    java.util.Arrays.fill(payload, offset, offset + paddingBytes, 'a'.toByte)
    offset += paddingBytes
    System.arraycopy(suffix, 0, payload, offset, suffix.length)
    // scalafix:on DisableSyntax.var
    payload

  private def stored(
      payload: Array[Byte],
      nestingDepth: Int,
  ): SeriesAnalysisStoredChunk = SeriesAnalysisStoredChunk(
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
    checksum = Some(sha256(payload)),
  )

  private def aggregate(summary: String): String = AggregatePrefix + summary + AggregateSuffix

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"
end PostgresSeriesAnalysisReadBoundSpec
