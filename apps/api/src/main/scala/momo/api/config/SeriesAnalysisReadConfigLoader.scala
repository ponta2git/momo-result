package momo.api.config

import scala.concurrent.duration.*

import cats.effect.Async
import cats.syntax.all.*
import ciris.{ConfigValue, Effect}

private[config] object SeriesAnalysisReadConfigLoader:
  // The runtime heap is capped at 256 MiB. Chunk materialization may use at most 160 MiB,
  // leaving 96 MiB for the HTTP runtime, connection pools, caches and request coordination.
  private[config] val MaximumConcurrentMaterializationBytes = 160L * 1024L * 1024L
  private val JsonNodeMaterializationBytes = 256L
  private val Utf16BytesPerDecodedByte = 2L
  private val MaximumPayloadBytes = 16L * 1024L * 1024L
  private val MaximumItemCount = 1000000
  private val MaximumNestingDepth = 64
  private val MaximumJsonNodes = 60000
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
      "ANALYSIS_API_MAX_JSON_NODES",
      SeriesAnalysisReadConfig.defaults.maxJsonNodes,
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
    val concurrentMaterializationBudget = maximumMaterializationBytes(value) *
      BigInt(value.decodeConcurrency)
    val valid =
      value.maxEncodedBytes <= MaximumPayloadBytes &&
        value.maxDecodedBytes <= MaximumPayloadBytes &&
        value.maxResponseBytes <= MaximumPayloadBytes &&
        value.maxItemCount <= MaximumItemCount &&
        value.maxNestingDepth <= MaximumNestingDepth &&
        value.maxJsonNodes <= MaximumJsonNodes &&
        value.decodeConcurrency <= MaximumDecodeConcurrency &&
        value.readTimeout <= MaximumReadTimeout &&
        value.busyRetryAfterSeconds <= MaximumBusyRetryAfterSeconds &&
        concurrentMaterializationBudget <= BigInt(MaximumConcurrentMaterializationBytes)
    Either.cond(
      valid,
      value,
      new IllegalArgumentException(
        "Series-analysis read limits exceed the supported reliability envelope."
      ),
    )

  /**
   * Deterministic admission budget for simultaneously live chunk representations: database bytes,
   * decoded UTF-16 string contents inside the Circe tree, hydrated tree nodes and rendered bytes.
   */
  private[config] def maximumMaterializationBytes(
      value: SeriesAnalysisReadConfig
  ): BigInt = BigInt(value.maxEncodedBytes) +
    BigInt(value.maxDecodedBytes) * Utf16BytesPerDecodedByte +
    BigInt(value.maxResponseBytes) +
    BigInt(value.maxJsonNodes) * JsonNodeMaterializationBytes
