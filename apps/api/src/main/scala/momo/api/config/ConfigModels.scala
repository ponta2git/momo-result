package momo.api.config

import scala.concurrent.duration.*

final case class DatabaseConfig(jdbcUrl: String, user: String, password: String, poolSize: Int)

final case class RedisConfig(
    url: String,
    v2Stream: String = RedisConfig.DefaultV2Stream,
    v2DeadLetterStream: String = RedisConfig.DefaultV2DeadLetterStream,
    analysisStream: String = RedisConfig.DefaultAnalysisStream,
)

final case class SeriesAnalysisReadConfig(
    maxEncodedBytes: Long,
    maxDecodedBytes: Long,
    maxResponseBytes: Long,
    maxItemCount: Int,
    maxNestingDepth: Int,
    decodeConcurrency: Int,
    readTimeout: FiniteDuration,
    busyRetryAfterSeconds: Int,
)

final case class ResourceLimitsConfig(
    uploadRateLimitPerMinute: Int,
    exportRateLimitPerMinute: Int,
    exportAllRateLimitPerMinute: Int,
    exportMaxRows: Int,
    exportMaxBytes: Long,
    sourceImageDownloadRateLimitPerMinute: Int,
    readApiRateLimitPerMinute: Int,
    sourceImageArchiveMaxBytes: Long,
    mutationRateLimitPerMinute: Int,
    idempotencyActiveKeyLimitPerAccount: Int,
    ocrJobCreateRateLimitPerMinute: Int,
    ocrJobCreateGlobalRateLimitPerMinute: Int,
    ocrActiveJobLimit: Int,
    requestMaxBytes: Long,
    uploadRequestMaxBytes: Long,
    imageUploadUnreferencedCountLimit: Int,
    imageUploadUnreferencedBytesLimit: Long,
    imageUploadStorageMinFreeBytes: Long,
    imageUploadStorageMaxUsedPercent: Int,
    imageOrphanOlderThan: FiniteDuration,
    imageOrphanReaperInterval: FiniteDuration,
    staleOcrJobAfter: FiniteDuration,
    staleOcrJobReaperInterval: FiniteDuration,
    sessionPruneInterval: FiniteDuration,
    ocrOutboxRecoveryInterval: FiniteDuration,
    ocrOutboxDueBacklogLimit: Int,
    ocrOutboxActiveBacklogLimit: Int,
    ocrOutboxOldestDueMaxDelay: FiniteDuration,
    ocrDeadLetterBacklogLimit: Int,
)

final case class AuthConfig(
    discordClientId: Option[String],
    discordClientSecret: Option[String],
    discordRedirectUri: Option[String],
    stateSigningKey: Option[String],
    sessionCookieName: String,
    stateCookieName: String,
    sessionTtl: FiniteDuration,
    stateTtl: FiniteDuration,
    rateLimitPerMinute: Int,
    callbackStateRateLimitPerMinute: Int,
    providerFailureThreshold: Int,
    providerBackoff: FiniteDuration,
    callbackRedirectPath: String,
    useSecureCookies: Boolean,
):
  val discordScope: String = "identify"

enum AppEnv derives CanEqual:
  case Dev, Test, Prod

object AppEnv:
  def fromString(value: String): Either[String, AppEnv] = value.toLowerCase match
    case "dev" => Right(AppEnv.Dev)
    case "test" => Right(AppEnv.Test)
    case "prod" => Right(AppEnv.Prod)

object AuthConfig:
  def defaults(appEnv: AppEnv): AuthConfig = AuthConfig(
    discordClientId = None,
    discordClientSecret = None,
    discordRedirectUri = None,
    stateSigningKey = None,
    sessionCookieName =
      if appEnv == AppEnv.Prod then "__Host-momo_result_session" else "momo_result_session",
    stateCookieName =
      if appEnv == AppEnv.Prod then "__Host-momo_result_oauth_state" else "momo_result_oauth_state",
    sessionTtl = 30.days,
    stateTtl = 300.seconds,
    rateLimitPerMinute = 10,
    callbackStateRateLimitPerMinute = 3,
    providerFailureThreshold = 3,
    providerBackoff = 60.seconds,
    callbackRedirectPath = "/",
    useSecureCookies = appEnv == AppEnv.Prod,
  )

object RedisConfig:
  val DefaultV2Stream: String = "momo:ocr:v2:jobs"
  val DefaultV2DeadLetterStream: String = "momo:ocr:v2:jobs:dead"
  val DefaultAnalysisStream: String = "momo:analysis:jobs"

object SeriesAnalysisReadConfig:
  val defaults: SeriesAnalysisReadConfig = SeriesAnalysisReadConfig(
    maxEncodedBytes = 16L * 1024L * 1024L,
    maxDecodedBytes = 16L * 1024L * 1024L,
    maxResponseBytes = 16L * 1024L * 1024L,
    maxItemCount = 1000000,
    maxNestingDepth = 64,
    decodeConcurrency = 2,
    readTimeout = 10.seconds,
    busyRetryAfterSeconds = 2,
  )

object ResourceLimitsConfig:
  val DefaultRequestMaxBytes: Long = 256L * 1024L
  val DefaultUploadRequestMaxBytes: Long = 3L * 1024L * 1024L + 64L * 1024L
  val DefaultExportMaxRows: Int = 20000
  val DefaultExportMaxBytes: Long = 16L * 1024L * 1024L
  val DefaultSourceImageArchiveMaxBytes: Long = 10L * 1024L * 1024L
  val DefaultImageUploadUnreferencedBytesLimit: Long = 64L * 1024L * 1024L
  val DefaultImageUploadStorageMinFreeBytes: Long = 256L * 1024L * 1024L

  val defaults: ResourceLimitsConfig = ResourceLimitsConfig(
    uploadRateLimitPerMinute = 20,
    exportRateLimitPerMinute = 30,
    exportAllRateLimitPerMinute = 6,
    exportMaxRows = DefaultExportMaxRows,
    exportMaxBytes = DefaultExportMaxBytes,
    sourceImageDownloadRateLimitPerMinute = 60,
    readApiRateLimitPerMinute = 120,
    sourceImageArchiveMaxBytes = DefaultSourceImageArchiveMaxBytes,
    mutationRateLimitPerMinute = 60,
    idempotencyActiveKeyLimitPerAccount = 240,
    ocrJobCreateRateLimitPerMinute = 10,
    ocrJobCreateGlobalRateLimitPerMinute = 20,
    ocrActiveJobLimit = 12,
    requestMaxBytes = DefaultRequestMaxBytes,
    uploadRequestMaxBytes = DefaultUploadRequestMaxBytes,
    imageUploadUnreferencedCountLimit = 24,
    imageUploadUnreferencedBytesLimit = DefaultImageUploadUnreferencedBytesLimit,
    imageUploadStorageMinFreeBytes = DefaultImageUploadStorageMinFreeBytes,
    imageUploadStorageMaxUsedPercent = 90,
    imageOrphanOlderThan = 15.minutes,
    imageOrphanReaperInterval = 5.minutes,
    staleOcrJobAfter = 300.seconds,
    staleOcrJobReaperInterval = 1800.seconds,
    sessionPruneInterval = 60.minutes,
    ocrOutboxRecoveryInterval = 1800.seconds,
    ocrOutboxDueBacklogLimit = 24,
    ocrOutboxActiveBacklogLimit = 48,
    ocrOutboxOldestDueMaxDelay = 600.seconds,
    ocrDeadLetterBacklogLimit = 24,
  )
