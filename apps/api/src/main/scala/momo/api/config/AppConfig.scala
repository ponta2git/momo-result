package momo.api.config

import java.net.URI
import java.nio.file.Path

import scala.concurrent.duration.*

import cats.MonadThrow
import cats.syntax.all.*

final case class DatabaseConfig(jdbcUrl: String, user: String, password: String, poolSize: Int)

final case class RedisConfig(url: String, stream: String, group: String)

final case class ResourceLimitsConfig(
    uploadRateLimitPerMinute: Int,
    exportRateLimitPerMinute: Int,
    uploadRequestMaxBytes: Long,
    imageOrphanOlderThan: FiniteDuration,
    imageOrphanReaperInterval: FiniteDuration,
    staleOcrJobAfter: FiniteDuration,
    staleOcrJobReaperInterval: FiniteDuration,
    sessionPruneInterval: FiniteDuration,
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

  def load[F[_]: MonadThrow]: F[AppConfig] =
    val env = sys.env
    val rawAppEnv = env.getOrElse("APP_ENV", "dev")
    AppEnv.fromString(rawAppEnv).leftMap(new IllegalArgumentException(_)).liftTo[F]
      .flatMap { appEnv =>
        (
          loadDatabase[F](env, appEnv),
          loadRedis[F](env, appEnv),
          loadAuth[F](env, appEnv),
          loadResourceLimits[F](env),
        ).mapN { (database, redis, auth, resourceLimits) =>
          AppConfig(
            appEnv = appEnv,
            httpHost = env.getOrElse("HTTP_HOST", "0.0.0.0"),
            httpPort = env.get("HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080),
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
        val (jdbcUrl, urlUser, urlPassword) = toJdbcUrl(rawUrl)
        val validated = ensureProdSslMode(jdbcUrl, appEnv)
        validated.map { safeJdbcUrl =>
          Some(DatabaseConfig(
            jdbcUrl = safeJdbcUrl,
            user = urlUser.orElse(env.get("DATABASE_USER").filter(_.nonEmpty)).getOrElse(""),
            password = urlPassword.orElse(env.get("DATABASE_PASSWORD").filter(_.nonEmpty))
              .getOrElse(""),
            poolSize = env.get("DB_POOL_SIZE").flatMap(_.toIntOption).getOrElse(2),
          ))
        }.liftTo[F]

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
      case Some(url) => MonadThrow[F].pure(Some(RedisConfig(
          url = url,
          stream = env.getOrElse("OCR_REDIS_STREAM", "momo:ocr:jobs"),
          group = env.getOrElse("OCR_REDIS_GROUP", "momo-ocr-workers"),
        )))

  private def loadAuth[F[_]: MonadThrow](env: Map[String, String], appEnv: AppEnv): F[AuthConfig] =
    val config = AuthConfig(
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
      sessionTtl = env.get("SESSION_TTL_DAYS").flatMap(_.toLongOption).getOrElse(30L).days,
      stateTtl = env.get("OAUTH_STATE_TTL_SECONDS").flatMap(_.toLongOption).getOrElse(300L).seconds,
      rateLimitPerMinute = env.get("AUTH_RATE_LIMIT_PER_MINUTE").flatMap(_.toIntOption)
        .getOrElse(10),
      callbackRedirectPath = env.getOrElse("AUTH_CALLBACK_REDIRECT_PATH", "/"),
      useSecureCookies = env.get("AUTH_COOKIE_SECURE").flatMap(_.toBooleanOption)
        .getOrElse(appEnv == AppEnv.Prod),
      useHostPrefix = env.get("AUTH_COOKIE_HOST_PREFIX").flatMap(_.toBooleanOption)
        .getOrElse(appEnv == AppEnv.Prod),
    )
    validateAuth[F](config, appEnv)

  private def validateAuth[F[_]: MonadThrow](config: AuthConfig, appEnv: AppEnv): F[AuthConfig] =
    val missing =
      if appEnv == AppEnv.Prod then
        List(
          "DISCORD_CLIENT_ID" -> config.discordClientId,
          "DISCORD_CLIENT_SECRET" -> config.discordClientSecret,
          "DISCORD_REDIRECT_URI" -> config.discordRedirectUri,
          "AUTH_STATE_SIGNING_KEY" -> config.stateSigningKey,
        ).collect { case (name, None) => name }
      else Nil
    if missing.nonEmpty then
      MonadThrow[F].raiseError(new IllegalArgumentException(
        s"Missing required production auth config: ${missing.mkString(", ")}"
      ))
    else MonadThrow[F].pure(config)

  private def loadResourceLimits[F[_]: MonadThrow](
      env: Map[String, String]
  ): F[ResourceLimitsConfig] = MonadThrow[F].pure(ResourceLimitsConfig(
    uploadRateLimitPerMinute = env.get("UPLOAD_RATE_LIMIT_PER_MINUTE").flatMap(_.toIntOption)
      .getOrElse(20),
    exportRateLimitPerMinute = env.get("EXPORT_RATE_LIMIT_PER_MINUTE").flatMap(_.toIntOption)
      .getOrElse(30),
    uploadRequestMaxBytes = env.get("UPLOAD_REQUEST_MAX_BYTES").flatMap(_.toLongOption)
      .getOrElse(ResourceLimitsConfig.DefaultUploadRequestMaxBytes),
    imageOrphanOlderThan = env.get("IMAGE_ORPHAN_OLDER_THAN_MINUTES").flatMap(_.toLongOption)
      .getOrElse(60L).minutes,
    imageOrphanReaperInterval = env.get("IMAGE_ORPHAN_REAPER_INTERVAL_MINUTES")
      .flatMap(_.toLongOption).getOrElse(60L).minutes,
    staleOcrJobAfter = env.get("STALE_OCR_JOB_AFTER_SECONDS").flatMap(_.toLongOption)
      .getOrElse(300L).seconds,
    staleOcrJobReaperInterval = env.get("STALE_OCR_JOB_REAPER_INTERVAL_SECONDS")
      .flatMap(_.toLongOption).getOrElse(60L).seconds,
    sessionPruneInterval = env.get("SESSION_PRUNE_INTERVAL_MINUTES").flatMap(_.toLongOption)
      .getOrElse(60L).minutes,
  ))

  /**
   * Convert a postgres:// or postgresql:// URL to a JDBC URL, extracting embedded credentials.
   * Returns (jdbcUrl, userOption, passwordOption). Already-prefixed jdbc:postgresql:// URLs are
   * passed through unchanged.
   */
  private[config] def toJdbcUrl(raw: String): (String, Option[String], Option[String]) =
    if raw.startsWith("jdbc:") then (raw, None, None)
    else
      val normalized = raw.replaceFirst("^postgres(ql)?://", "postgresql://")
      val uri = URI.create(normalized)
      val userInfo = Option(uri.getUserInfo)
      val (user, pass) = userInfo match
        case None => (None, None)
        case Some(info) =>
          val parts = info.split(":", 2)
          (Some(parts(0)).filter(_.nonEmpty), if parts.length > 1 then Some(parts(1)) else None)
      val host = Option(uri.getHost).getOrElse("localhost")
      val port = if uri.getPort > 0 then s":${uri.getPort}" else ""
      val path = Option(uri.getRawPath).getOrElse("")
      val query = Option(uri.getRawQuery).map(q => s"?$q").getOrElse("")
      val jdbcUrl = s"jdbc:postgresql://$host$port$path$query"
      (jdbcUrl, user, pass)

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
    callbackRedirectPath = "/",
    useSecureCookies = appEnv == AppEnv.Prod,
    useHostPrefix = appEnv == AppEnv.Prod,
  )

object ResourceLimitsConfig:
  val DefaultUploadRequestMaxBytes: Long = 3L * 1024L * 1024L + 64L * 1024L

  val defaults: ResourceLimitsConfig = ResourceLimitsConfig(
    uploadRateLimitPerMinute = 20,
    exportRateLimitPerMinute = 30,
    uploadRequestMaxBytes = DefaultUploadRequestMaxBytes,
    imageOrphanOlderThan = 60.minutes,
    imageOrphanReaperInterval = 60.minutes,
    staleOcrJobAfter = 300.seconds,
    staleOcrJobReaperInterval = 60.seconds,
    sessionPruneInterval = 60.minutes,
  )
