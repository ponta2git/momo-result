package momo.api.config

import java.net.URI
import java.nio.file.Path

import scala.concurrent.duration.*

import cats.MonadThrow
import cats.syntax.all.*

final case class DatabaseConfig(jdbcUrl: String, user: String, password: String, poolSize: Int)

final case class RedisConfig(
    url: String,
    stream: String,
    group: String,
    deadLetterStream: String = RedisConfig.DefaultDeadLetterStream,
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
    useHostPrefix: Boolean,
):
  val discordScope: String = "identify"

final case class AppConfig(
    appEnv: AppEnv,
    httpHost: String,
    httpPort: Int,
    imageTmpDir: Path,
    devMemberIds: List[String],
    auth: AuthConfig = AuthConfig.defaults(AppEnv.Dev),
    resourceLimits: ResourceLimitsConfig = ResourceLimitsConfig.defaults,
    database: Option[DatabaseConfig] = None,
    redis: Option[RedisConfig] = None,
)

enum AppEnv derives CanEqual:
  case Dev, Test, Prod

object AppEnv:
  def fromString(value: String): Either[String, AppEnv] = value.toLowerCase match
    case "dev" => Right(AppEnv.Dev)
    case "test" => Right(AppEnv.Test)
    case "prod" => Right(AppEnv.Prod)
    case other => Left(s"Unsupported APP_ENV: $other")

object AppConfig:
  private val DefaultDevMemberIds: List[String] =
    List("member_ponta", "member_akane_mami", "member_otaka", "member_eu")

  def load[F[_]: MonadThrow]: F[AppConfig] = loadFromEnv(sys.env)

  private[config] def loadFromEnv[F[_]: MonadThrow](env: Map[String, String]): F[AppConfig] =
    val rawAppEnv = env.getOrElse("APP_ENV", "dev")
    AppEnv.fromString(rawAppEnv).leftMap(new IllegalArgumentException(_)).liftTo[F]
      .flatMap { appEnv =>
        (
          loadDatabase[F](env, appEnv),
          loadRedis[F](env, appEnv),
          loadAuth[F](env, appEnv),
          loadResourceLimits[F](env),
          parsePort(env, "HTTP_PORT", default = 8080).liftTo[F],
        ).mapN { (database, redis, auth, resourceLimits, httpPort) =>
          AppConfig(
            appEnv = appEnv,
            httpHost = env.getOrElse("HTTP_HOST", "0.0.0.0"),
            httpPort = httpPort,
            imageTmpDir = Path.of(env.getOrElse("IMAGE_TMP_DIR", "/tmp/momo-result/uploads"))
              .toAbsolutePath,
            devMemberIds = env.get("DEV_MEMBER_IDS")
              .map(_.split(",").iterator.map(_.trim).filter(_.nonEmpty).toList)
              .getOrElse(DefaultDevMemberIds),
            auth = auth,
            resourceLimits = resourceLimits,
            database = database,
            redis = redis,
          )
        }
      }

  private def loadDatabase[F[_]: MonadThrow](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[DatabaseConfig]] =
    val urlOpt = env.get("DATABASE_URL").filter(_.nonEmpty)
    urlOpt match
      case None if appEnv == AppEnv.Prod =>
        MonadThrow[F]
          .raiseError(new IllegalArgumentException("DATABASE_URL is required in prod APP_ENV"))
      case None => MonadThrow[F].pure(None)
      case Some(rawUrl) =>
        for
          parsed <- toJdbcUrl(rawUrl).liftTo[F]
          (jdbcUrl, urlUser, urlPassword) = parsed
          safeJdbcUrl <- ensureProdSslMode(jdbcUrl, appEnv).liftTo[F]
          poolSize <- parsePositiveInt(env, "DB_POOL_SIZE", default = 2).liftTo[F]
        yield Some(DatabaseConfig(
          jdbcUrl = safeJdbcUrl,
          user = urlUser.orElse(env.get("DATABASE_USER").filter(_.nonEmpty)).getOrElse(""),
          password = urlPassword.orElse(env.get("DATABASE_PASSWORD").filter(_.nonEmpty))
            .getOrElse(""),
          poolSize = poolSize,
        ))

  private def loadRedis[F[_]: MonadThrow](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[RedisConfig]] =
    val urlOpt = env.get("REDIS_URL").filter(_.nonEmpty)
    urlOpt match
      case None if appEnv == AppEnv.Prod =>
        MonadThrow[F]
          .raiseError(new IllegalArgumentException("REDIS_URL is required in prod APP_ENV"))
      case None => MonadThrow[F].pure(None)
      case Some(url) => ensureProdRedisUrl(url, appEnv).liftTo[F].map(url =>
          Some(RedisConfig(
            url = url,
            stream = env.getOrElse("OCR_REDIS_STREAM", "momo:ocr:jobs"),
            group = env.getOrElse("OCR_REDIS_GROUP", "momo-ocr-workers"),
            deadLetterStream = env
              .getOrElse("OCR_REDIS_DEAD_LETTER_STREAM", RedisConfig.DefaultDeadLetterStream),
          ))
        )

  private def loadAuth[F[_]: MonadThrow](env: Map[String, String], appEnv: AppEnv): F[AuthConfig] =
    (
      parsePositiveLong(env, "SESSION_TTL_DAYS", default = 30L),
      parsePositiveLong(env, "OAUTH_STATE_TTL_SECONDS", default = 300L),
      parseNonNegativeInt(env, "AUTH_RATE_LIMIT_PER_MINUTE", default = 10),
      parseNonNegativeInt(env, "AUTH_CALLBACK_STATE_RATE_LIMIT_PER_MINUTE", default = 3),
      parsePositiveInt(env, "AUTH_PROVIDER_FAILURE_THRESHOLD", default = 3),
      parsePositiveLong(env, "AUTH_PROVIDER_BACKOFF_SECONDS", default = 60L),
      parseBoolean(env, "AUTH_COOKIE_SECURE", default = appEnv == AppEnv.Prod),
      parseBoolean(env, "AUTH_COOKIE_HOST_PREFIX", default = appEnv == AppEnv.Prod),
    ).mapN {
      (
          sessionTtlDays,
          stateTtlSeconds,
          rateLimit,
          callbackStateRateLimit,
          providerFailureThreshold,
          providerBackoffSeconds,
          secureCookies,
          hostPrefix,
      ) =>
        AuthConfig(
          discordClientId = env.get("DISCORD_CLIENT_ID").filter(_.nonEmpty),
          discordClientSecret = env.get("DISCORD_CLIENT_SECRET").filter(_.nonEmpty),
          discordRedirectUri = env.get("DISCORD_REDIRECT_URI").filter(_.nonEmpty),
          stateSigningKey = env.get("AUTH_STATE_SIGNING_KEY").filter(_.nonEmpty),
          sessionCookieName = env.getOrElse(
            "SESSION_COOKIE_NAME",
            if appEnv == AppEnv.Prod then "__Host-momo_result_session" else "momo_result_session",
          ),
          stateCookieName = env.getOrElse(
            "OAUTH_STATE_COOKIE_NAME",
            if appEnv == AppEnv.Prod then "__Host-momo_result_oauth_state"
            else "momo_result_oauth_state",
          ),
          sessionTtl = sessionTtlDays.days,
          stateTtl = stateTtlSeconds.seconds,
          rateLimitPerMinute = rateLimit,
          callbackStateRateLimitPerMinute = callbackStateRateLimit,
          providerFailureThreshold = providerFailureThreshold,
          providerBackoff = providerBackoffSeconds.seconds,
          callbackRedirectPath = env.getOrElse("AUTH_CALLBACK_REDIRECT_PATH", "/"),
          useSecureCookies = secureCookies,
          useHostPrefix = hostPrefix,
        )
    }.liftTo[F].flatMap(validateAuth[F](_, appEnv))

  private def validateAuth[F[_]: MonadThrow](config: AuthConfig, appEnv: AppEnv): F[AuthConfig] =
    val problems = if appEnv == AppEnv.Prod then prodAuthProblems(config) else Nil
    if problems.nonEmpty then
      MonadThrow[F]
        .raiseError(new IllegalArgumentException(s"Invalid production auth config: ${problems
            .mkString(", ")}"))
    else MonadThrow[F].pure(config)

  private def prodAuthProblems(config: AuthConfig): List[String] =
    val missing = List(
      "DISCORD_CLIENT_ID" -> config.discordClientId,
      "DISCORD_CLIENT_SECRET" -> config.discordClientSecret,
      "DISCORD_REDIRECT_URI" -> config.discordRedirectUri,
      "AUTH_STATE_SIGNING_KEY" -> config.stateSigningKey,
    ).collect { case (name, None) => s"$name is required" }
    val secureCookie = Option.when(!config.useSecureCookies)("AUTH_COOKIE_SECURE must be true")
    val hostPrefix = Option.when(
      config.useHostPrefix &&
        (!config.sessionCookieName.startsWith("__Host-") ||
          !config.stateCookieName.startsWith("__Host-"))
    )("AUTH_COOKIE_HOST_PREFIX requires __Host- session and OAuth state cookie names")
    val redirect = Option.when(!RedirectPath.isSafe(config.callbackRedirectPath))(
      "AUTH_CALLBACK_REDIRECT_PATH must be a root-relative path"
    )
    missing ++ List(secureCookie, hostPrefix, redirect).flatten

  private def loadResourceLimits[F[_]: MonadThrow](
      env: Map[String, String]
  ): F[ResourceLimitsConfig] = (
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
      parsePositiveLong(env, "OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS", default = 1800L),
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
          ocrOutboxRecoveryInterval,
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
          ocrOutboxRecoveryInterval = ocrOutboxRecoveryInterval.seconds,
          ocrOutboxDueBacklogLimit = ocrOutboxDueBacklogLimit,
          ocrOutboxActiveBacklogLimit = ocrOutboxActiveBacklogLimit,
          ocrOutboxOldestDueMaxDelay = ocrOutboxOldestDueMaxDelay.seconds,
          ocrDeadLetterBacklogLimit = ocrDeadLetterBacklogLimit,
        )
    }
  }.liftTo[F]

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

  private def loadExportResourceLimits(
      env: Map[String, String]
  ): Either[Throwable, ExportResourceLimits] = (
    parseNonNegativeInt(env, "EXPORT_RATE_LIMIT_PER_MINUTE", default = 30),
    parseNonNegativeInt(env, "EXPORT_ALL_RATE_LIMIT_PER_MINUTE", default = 6),
    parsePositiveInt(env, "EXPORT_MAX_ROWS", ResourceLimitsConfig.DefaultExportMaxRows),
    parsePositiveLong(env, "EXPORT_MAX_BYTES", ResourceLimitsConfig.DefaultExportMaxBytes),
  ).mapN(ExportResourceLimits.apply)

  private def loadApiResourceLimits(
      env: Map[String, String]
  ): Either[Throwable, ApiResourceLimits] = (
    parseNonNegativeInt(env, "READ_API_RATE_LIMIT_PER_MINUTE", default = 120),
    parseNonNegativeInt(env, "MUTATION_RATE_LIMIT_PER_MINUTE", default = 60),
    parseNonNegativeInt(env, "IDEMPOTENCY_ACTIVE_KEY_LIMIT_PER_ACCOUNT", default = 240),
  ).mapN(ApiResourceLimits.apply)

  private[config] def parsePositiveInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(env, name, default, _ > 0, "positive integer")

  private[config] def parseNonNegativeInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(env, name, default, _ >= 0, "non-negative integer")

  private[config] def parsePositiveLong(
      env: Map[String, String],
      name: String,
      default: Long,
  ): Either[Throwable, Long] = parseLong(env, name, default, _ > 0L, "positive integer")

  private[config] def parsePort(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(
    env,
    name,
    default,
    value => value > 0 && value <= 65535,
    "TCP port between 1 and 65535",
  )

  private[config] def parsePercent(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(
    env,
    name,
    default,
    value => value >= 1 && value <= 100,
    "integer percentage between 1 and 100",
  )

  private[config] def parseBoolean(
      env: Map[String, String],
      name: String,
      default: Boolean,
  ): Either[Throwable, Boolean] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toBooleanOption
        .toRight(new IllegalArgumentException(s"$name must be true or false, got: $raw"))

  private def parseInt(
      env: Map[String, String],
      name: String,
      default: Int,
      valid: Int => Boolean,
      description: String,
  ): Either[Throwable, Int] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toIntOption.filter(valid)
        .toRight(new IllegalArgumentException(s"$name must be a $description, got: $raw"))

  private def parseLong(
      env: Map[String, String],
      name: String,
      default: Long,
      valid: Long => Boolean,
      description: String,
  ): Either[Throwable, Long] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toLongOption.filter(valid)
        .toRight(new IllegalArgumentException(s"$name must be a $description, got: $raw"))

  /**
   * Convert a postgres:// or postgresql:// URL to a JDBC URL, extracting embedded credentials.
   * Returns (jdbcUrl, userOption, passwordOption). Already-prefixed jdbc:postgresql:// URLs are
   * passed through unchanged.
   */
  private[config] def toJdbcUrl(
      raw: String
  ): Either[Throwable, (String, Option[String], Option[String])] =
    if raw.startsWith("jdbc:postgresql://") then Right((raw, None, None))
    else if raw.startsWith("jdbc:") then
      Left(new IllegalArgumentException(
        "DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"
      ))
    else
      Either.catchNonFatal(URI.create(raw.replaceFirst("^postgres(ql)?://", "postgresql://")))
        .leftMap(error =>
          new IllegalArgumentException("DATABASE_URL must be a valid Postgres URL.", error)
        ).flatMap { uri =>
          Option(uri.getScheme).filter(_ == "postgresql").toRight(new IllegalArgumentException(
            "DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"
          )).flatMap(_ =>
            Option(uri.getHost).filter(_.trim.nonEmpty)
              .toRight(new IllegalArgumentException("DATABASE_URL must include a database host"))
              .map(host => (uri, host))
          )
        }.map { case (uri, host) =>
          val userInfo = Option(uri.getUserInfo)
          val (user, pass) = userInfo match
            case None => (None, None)
            case Some(info) =>
              val parts = info.split(":", 2)
              (Some(parts(0)).filter(_.nonEmpty), if parts.length > 1 then Some(parts(1)) else None)
          val port = if uri.getPort > 0 then s":${uri.getPort}" else ""
          val path = Option(uri.getRawPath).getOrElse("")
          val query = Option(uri.getRawQuery).map(q => s"?$q").getOrElse("")
          val jdbcUrl = s"jdbc:postgresql://$host$port$path$query"
          (jdbcUrl, user, pass)
        }

  private[config] def ensureProdSslMode(
      jdbcUrl: String,
      appEnv: AppEnv,
  ): Either[Throwable, String] =
    if appEnv != AppEnv.Prod then Right(jdbcUrl)
    else
      val sslMode = jdbcQueryParams(jdbcUrl).get("sslmode").flatMap(_.lastOption)
      sslMode match
        case Some(value)
            if value.equalsIgnoreCase("require") || value.equalsIgnoreCase("verify-ca") ||
              value.equalsIgnoreCase("verify-full") => Right(jdbcUrl)
        case Some(value) => Left(new IllegalArgumentException(
            s"DATABASE_URL sslmode must be require, verify-ca, or verify-full in prod APP_ENV, got: $value"
          ))
        case None => Right(appendJdbcQueryParam(jdbcUrl, "sslmode", "require"))

  private def jdbcQueryParams(jdbcUrl: String): Map[String, List[String]] =
    val queryStart = jdbcUrl.indexOf('?')
    if queryStart < 0 || queryStart == jdbcUrl.length - 1 then Map.empty
    else
      jdbcUrl.substring(queryStart + 1).split("&").iterator.toList.filter(_.nonEmpty)
        .foldLeft(Map.empty[String, List[String]]) { (acc, part) =>
          val key = part.takeWhile(_ != '=')
          val value = part.drop(key.length).stripPrefix("=")
          acc.updated(key, acc.getOrElse(key, Nil) :+ value)
        }

  private def appendJdbcQueryParam(jdbcUrl: String, key: String, value: String): String =
    val separator = if jdbcUrl.contains("?") then "&" else "?"
    s"$jdbcUrl$separator$key=$value"

  private[config] def ensureProdRedisUrl(raw: String, appEnv: AppEnv): Either[Throwable, String] =
    if appEnv != AppEnv.Prod then Right(raw)
    else
      Either.catchNonFatal(URI.create(raw))
        .leftMap(_ => new IllegalArgumentException("REDIS_URL must be a valid Redis URL."))
        .flatMap { uri =>
          Option(uri.getScheme).filter(_.equalsIgnoreCase("rediss"))
            .toRight(new IllegalArgumentException("REDIS_URL must use rediss:// in prod APP_ENV."))
            .flatMap(_ =>
              Option(uri.getHost).filter(_.trim.nonEmpty)
                .toRight(new IllegalArgumentException("REDIS_URL must include a Redis host."))
            ).as(raw)
        }

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
    useHostPrefix = appEnv == AppEnv.Prod,
  )

object RedisConfig:
  val DefaultDeadLetterStream: String = "momo:ocr:jobs:dead"

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
