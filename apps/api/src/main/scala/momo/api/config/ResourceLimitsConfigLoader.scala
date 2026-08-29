package momo.api.config

import scala.concurrent.duration.*

import cats.effect.Async
import cats.syntax.all.*
import ciris.{ConfigValue, Effect}

import ConfigParsers.*

private[config] object ResourceLimitsConfigLoader:
  def load[F[_]: Async](
      env: Map[String, String]
  ): F[ResourceLimitsConfig] = config(env).load[F]

  private def config(env: Map[String, String]): ConfigValue[Effect, ResourceLimitsConfig] = (
    parseNonNegativeInt(env, "SOURCE_IMAGE_DOWNLOAD_RATE_LIMIT_PER_MINUTE", default = 60),
    parsePositiveLong(
      env,
      "SOURCE_IMAGE_ARCHIVE_MAX_BYTES",
      ResourceLimitsConfig.DefaultSourceImageArchiveMaxBytes,
    ),
  ).mapN((sourceImageDownloadRateLimit, sourceImageArchiveMaxBytes) =>
    sourceImageDownloadRateLimit -> sourceImageArchiveMaxBytes
  ).flatMap { case (sourceImageDownloadRateLimit, sourceImageArchiveMaxBytes) =>
    (
      parseNonNegativeInt(env, "UPLOAD_RATE_LIMIT_PER_MINUTE", default = 20),
      loadExportResourceLimits(env),
      loadApiResourceLimits(env),
      parseNonNegativeInt(env, "OCR_JOB_CREATE_RATE_LIMIT_PER_MINUTE", default = 10),
      parseNonNegativeInt(env, "OCR_JOB_CREATE_GLOBAL_RATE_LIMIT_PER_MINUTE", default = 20),
      parseNonNegativeInt(env, "OCR_ACTIVE_JOB_LIMIT", default = 12),
      parsePositiveLong(env, "REQUEST_MAX_BYTES", ResourceLimitsConfig.DefaultRequestMaxBytes),
      parsePositiveLong(
        env,
        "UPLOAD_REQUEST_MAX_BYTES",
        ResourceLimitsConfig.DefaultUploadRequestMaxBytes,
      ),
      parseNonNegativeInt(env, "IMAGE_UPLOAD_UNREFERENCED_COUNT_LIMIT", default = 24),
      parsePositiveLong(
        env,
        "IMAGE_UPLOAD_UNREFERENCED_BYTES_LIMIT",
        ResourceLimitsConfig.DefaultImageUploadUnreferencedBytesLimit,
      ),
      parsePositiveLong(
        env,
        "IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES",
        ResourceLimitsConfig.DefaultImageUploadStorageMinFreeBytes,
      ),
      parsePercent(env, "IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT", default = 90),
      parsePositiveLong(env, "IMAGE_ORPHAN_OLDER_THAN_MINUTES", default = 15L),
      parsePositiveLong(env, "IMAGE_ORPHAN_REAPER_INTERVAL_MINUTES", default = 5L),
      parsePositiveLong(env, "STALE_OCR_JOB_AFTER_SECONDS", default = 300L),
      parsePositiveLong(env, "STALE_OCR_JOB_REAPER_INTERVAL_SECONDS", default = 1800L),
      parsePositiveLong(env, "SESSION_PRUNE_INTERVAL_MINUTES", default = 60L),
      loadOutboxIntervals(env),
      parseNonNegativeInt(env, "OCR_OUTBOX_DUE_BACKLOG_LIMIT", default = 24),
      parseNonNegativeInt(env, "OCR_OUTBOX_ACTIVE_BACKLOG_LIMIT", default = 48),
      parsePositiveLong(env, "OCR_OUTBOX_OLDEST_DUE_MAX_DELAY_SECONDS", default = 600L),
      parseNonNegativeInt(env, "OCR_DEAD_LETTER_BACKLOG_LIMIT", default = 24),
    ).mapN {
      (
          uploadRateLimit,
          exportLimits,
          apiLimits,
          ocrJobCreateRateLimit,
          ocrJobCreateGlobalRateLimit,
          ocrActiveJobLimit,
          requestMaxBytes,
          uploadRequestMaxBytes,
          imageUploadUnreferencedCountLimit,
          imageUploadUnreferencedBytesLimit,
          imageUploadStorageMinFreeBytes,
          imageUploadStorageMaxUsedPercent,
          orphanOlderThan,
          orphanReaperInterval,
          staleOcrJobAfter,
          staleOcrJobReaperInterval,
          sessionPruneInterval,
          outboxIntervals,
          ocrOutboxDueBacklogLimit,
          ocrOutboxActiveBacklogLimit,
          ocrOutboxOldestDueMaxDelay,
          ocrDeadLetterBacklogLimit,
      ) =>
        ResourceLimitsConfig(
          uploadRateLimitPerMinute = uploadRateLimit,
          exportRateLimitPerMinute = exportLimits.rateLimitPerMinute,
          exportAllRateLimitPerMinute = exportLimits.allRateLimitPerMinute,
          exportMaxRows = exportLimits.maxRows,
          exportMaxBytes = exportLimits.maxBytes,
          sourceImageDownloadRateLimitPerMinute = sourceImageDownloadRateLimit,
          readApiRateLimitPerMinute = apiLimits.readRateLimitPerMinute,
          sourceImageArchiveMaxBytes = sourceImageArchiveMaxBytes,
          mutationRateLimitPerMinute = apiLimits.mutationRateLimitPerMinute,
          idempotencyActiveKeyLimitPerAccount = apiLimits.idempotencyActiveKeyLimitPerAccount,
          ocrJobCreateRateLimitPerMinute = ocrJobCreateRateLimit,
          ocrJobCreateGlobalRateLimitPerMinute = ocrJobCreateGlobalRateLimit,
          ocrActiveJobLimit = ocrActiveJobLimit,
          requestMaxBytes = requestMaxBytes,
          uploadRequestMaxBytes = uploadRequestMaxBytes,
          imageUploadUnreferencedCountLimit = imageUploadUnreferencedCountLimit,
          imageUploadUnreferencedBytesLimit = imageUploadUnreferencedBytesLimit,
          imageUploadStorageMinFreeBytes = imageUploadStorageMinFreeBytes,
          imageUploadStorageMaxUsedPercent = imageUploadStorageMaxUsedPercent,
          imageOrphanOlderThan = orphanOlderThan.minutes,
          imageOrphanReaperInterval = orphanReaperInterval.minutes,
          staleOcrJobAfter = staleOcrJobAfter.seconds,
          staleOcrJobReaperInterval = staleOcrJobReaperInterval.seconds,
          sessionPruneInterval = sessionPruneInterval.minutes,
          ocrOutboxRecoveryInterval = outboxIntervals.ocrRecovery,
          ocrOutboxSemanticRedeliveryInterval = outboxIntervals.ocrSemanticRedelivery,
          ocrOutboxDueBacklogLimit = ocrOutboxDueBacklogLimit,
          ocrOutboxActiveBacklogLimit = ocrOutboxActiveBacklogLimit,
          ocrOutboxOldestDueMaxDelay = ocrOutboxOldestDueMaxDelay.seconds,
          ocrDeadLetterBacklogLimit = ocrDeadLetterBacklogLimit,
        )
    }
  }

  private final case class ExportResourceLimits(
      rateLimitPerMinute: Int,
      allRateLimitPerMinute: Int,
      maxRows: Int,
      maxBytes: Long,
  )

  private final case class ApiResourceLimits(
      readRateLimitPerMinute: Int,
      mutationRateLimitPerMinute: Int,
      idempotencyActiveKeyLimitPerAccount: Int,
  )

  private final case class OutboxIntervals(
      ocrRecovery: FiniteDuration,
      ocrSemanticRedelivery: FiniteDuration,
  )

  private def loadExportResourceLimits(
      env: Map[String, String]
  ): ConfigValue[Effect, ExportResourceLimits] = (
    parseNonNegativeInt(env, "EXPORT_RATE_LIMIT_PER_MINUTE", default = 30),
    parseNonNegativeInt(env, "EXPORT_ALL_RATE_LIMIT_PER_MINUTE", default = 6),
    parsePositiveInt(env, "EXPORT_MAX_ROWS", ResourceLimitsConfig.DefaultExportMaxRows),
    parsePositiveLong(env, "EXPORT_MAX_BYTES", ResourceLimitsConfig.DefaultExportMaxBytes),
  ).mapN(ExportResourceLimits.apply)

  private def loadApiResourceLimits(
      env: Map[String, String]
  ): ConfigValue[Effect, ApiResourceLimits] = (
    parseNonNegativeInt(env, "READ_API_RATE_LIMIT_PER_MINUTE", default = 120),
    parseNonNegativeInt(env, "MUTATION_RATE_LIMIT_PER_MINUTE", default = 60),
    parseNonNegativeInt(env, "IDEMPOTENCY_ACTIVE_KEY_LIMIT_PER_ACCOUNT", default = 240),
  ).mapN(ApiResourceLimits.apply)

  private def loadOutboxIntervals(
      env: Map[String, String]
  ): ConfigValue[Effect, OutboxIntervals] = (
    parsePositiveLong(env, "OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS", default = 300L),
    parsePositiveLong(env, "OCR_OUTBOX_REDELIVERY_AFTER_SECONDS", default = 120L),
  ).mapN((ocrRecovery, ocrSemantic) =>
    OutboxIntervals(ocrRecovery.seconds, ocrSemantic.seconds)
  )
