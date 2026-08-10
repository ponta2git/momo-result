package momo.api.config

import scala.concurrent.duration.*

import cats.effect.Async
import cats.syntax.all.*
import ciris.{ConfigValue, Effect}

private[config] object SeriesAnalysisReadConfigLoader:
  private val MaximumPayloadBytes = 16L * 1024L * 1024L
  private val MaximumConcurrentPayloadBytes = 32L * 1024L * 1024L
  private val MaximumItemCount = 1000000
  private val MaximumNestingDepth = 64
  private val MaximumDecodeConcurrency = 4
  private val MaximumReadTimeout = 30.seconds
  private val MaximumBusyRetryAfterSeconds = 60

  def load[F[_]: Async](env: Map[String, String]): F[SeriesAnalysisReadConfig] = config(env)
    .load[F].flatMap(value => validate(value).liftTo[F])

  private def config(
      env: Map[String, String]
  ): ConfigValue[Effect, SeriesAnalysisReadConfig] = (
    ConfigParsers.parsePositiveLong(
      env,
      "ANALYSIS_API_MAX_ENCODED_BYTES",
      SeriesAnalysisReadConfig.defaults.maxEncodedBytes,
    ),
    ConfigParsers.parsePositiveLong(
      env,
      "ANALYSIS_API_MAX_DECODED_BYTES",
      SeriesAnalysisReadConfig.defaults.maxDecodedBytes,
    ),
    ConfigParsers.parsePositiveLong(
      env,
      "ANALYSIS_API_MAX_RESPONSE_BYTES",
      SeriesAnalysisReadConfig.defaults.maxResponseBytes,
    ),
    ConfigParsers.parsePositiveInt(
      env,
      "ANALYSIS_API_MAX_ITEM_COUNT",
      SeriesAnalysisReadConfig.defaults.maxItemCount,
    ),
    ConfigParsers.parsePositiveInt(
      env,
      "ANALYSIS_API_MAX_NESTING_DEPTH",
      SeriesAnalysisReadConfig.defaults.maxNestingDepth,
    ),
    ConfigParsers.parsePositiveInt(
      env,
      "ANALYSIS_API_DECODE_CONCURRENCY",
      SeriesAnalysisReadConfig.defaults.decodeConcurrency,
    ),
    ConfigParsers.parsePositiveLong(
      env,
      "ANALYSIS_API_READ_TIMEOUT_MS",
      SeriesAnalysisReadConfig.defaults.readTimeout.toMillis,
    ).map(_.millis),
    ConfigParsers.parsePositiveInt(
      env,
      "ANALYSIS_API_BUSY_RETRY_AFTER_SECONDS",
      SeriesAnalysisReadConfig.defaults.busyRetryAfterSeconds,
    ),
  ).mapN(SeriesAnalysisReadConfig.apply)

  private def validate(
      value: SeriesAnalysisReadConfig
  ): Either[IllegalArgumentException, SeriesAnalysisReadConfig] =
    val largestPayload = List(
      value.maxEncodedBytes,
      value.maxDecodedBytes,
      value.maxResponseBytes,
    ).max
    val concurrentPayloadBudget = BigInt(largestPayload) * BigInt(value.decodeConcurrency)
    val valid =
      largestPayload <= MaximumPayloadBytes &&
        value.maxItemCount <= MaximumItemCount &&
        value.maxNestingDepth <= MaximumNestingDepth &&
        value.decodeConcurrency <= MaximumDecodeConcurrency &&
        value.readTimeout <= MaximumReadTimeout &&
        value.busyRetryAfterSeconds <= MaximumBusyRetryAfterSeconds &&
        concurrentPayloadBudget <= BigInt(MaximumConcurrentPayloadBytes)
    Either.cond(
      valid,
      value,
      new IllegalArgumentException(
        "Series-analysis read limits exceed the supported reliability envelope."
      ),
    )
