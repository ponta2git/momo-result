package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.syntax.all.*
import io.circe.Json
import io.circe.parser.parse
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
import momo.api.testing.JsonSchemaAssertions

final class PostgresSeriesAnalysisReadBoundSpec extends CatsEffectSuite with JsonSchemaAssertions:
  private val gameTitleId = GameTitleId.unsafeFromString("title-read-bound")
  private val scope = SeriesAnalysisScope.Overall
  private val request = SeriesAnalysisChunkRequest(
    SeriesAnalysisChunkKind.Aggregate,
    gameTitleId,
    "artifact-read-bound",
    scope,
  )

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

  test("an owner-valid fixture materializes at exact configured bounds and concurrency"):
    for
      fixture <- IO.blocking(exactBoundedFixture())
      (payload, config, nestingDepth) = fixture
      results <- List.range(0, config.decodeConcurrency).parTraverse(_ =>
        IO.blocking {
          val privatePayload = payload.clone()
          PostgresSeriesAnalysisChunkCodec
            .decode(stored(privatePayload, nestingDepth), request, config, None)
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
      assertEquals(payload.length.toLong, config.maxEncodedBytes)
      results.foreach {
        case Right(chunk) => assertEquals(chunk.payload.length.toLong, config.maxResponseBytes)
        case Left(error) => fail(s"maximum concurrent materialization failed: $error")
      }

  private def exactBoundedFixture(): (Array[Byte], SeriesAnalysisReadConfig, Int) =
    val payload = Files.readAllBytes(
      repositoryFile("docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json")
    )
    val parsed = parse(new String(payload, StandardCharsets.UTF_8))
      .fold(error => fail(s"invalid owner aggregate fixture: $error"), identity)
    val nestingDepth = jsonDepth(parsed)
    val defaults = SeriesAnalysisReadConfig.defaults
    val decoded = PostgresSeriesAnalysisChunkCodec
      .decode(stored(payload, nestingDepth), request, defaults, None)
      .fold(error => fail(s"invalid owner aggregate fixture: $error"), identity)
    val rendered = PostgresSeriesAnalysisChunkCodec
      .hydrateAndRender(
        decoded,
        Map.empty,
        Some("総合"),
        defaults.copy(maxResponseBytes = Long.MaxValue),
      )
      .fold(error => fail(s"owner aggregate hydration failed: $error"), identity)
    val exactConfig = defaults.copy(
      maxEncodedBytes = payload.length.toLong,
      maxDecodedBytes = payload.length.toLong,
      maxResponseBytes = rendered.payload.length.toLong,
      maxJsonNodes = decoded.nodeCount,
    )
    (payload, exactConfig, nestingDepth)

  private def jsonDepth(value: Json): Int = value.arrayOrObject(
    1,
    values => 1 + values.map(jsonDepth).maxOption.getOrElse(0),
    fields => 1 + fields.values.map(jsonDepth).maxOption.getOrElse(0),
  )

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

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"
end PostgresSeriesAnalysisReadBoundSpec
