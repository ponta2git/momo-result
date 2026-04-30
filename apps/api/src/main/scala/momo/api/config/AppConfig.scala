package momo.api.config

import cats.syntax.all.*
import cats.MonadThrow
import java.nio.file.Path
import scala.concurrent.duration.*

final case class DatabaseConfig(jdbcUrl: String, user: String, password: String, poolSize: Int)

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
    database: Option[DatabaseConfig] = None,
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
    AppEnv.fromString(rawAppEnv).leftMap(new IllegalArgumentException(_)).liftTo[F].flatMap {
      appEnv =>
        (loadDatabase[F](env, appEnv), loadAuth[F](env, appEnv)).mapN { (database, auth) =>
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
            database = database,
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
      case Some(jdbcUrl) => MonadThrow[F].pure(Some(DatabaseConfig(
          jdbcUrl = jdbcUrl,
          user = env.getOrElse("DATABASE_USER", ""),
          password = env.getOrElse("DATABASE_PASSWORD", ""),
          poolSize = env.get("DB_POOL_SIZE").flatMap(_.toIntOption).getOrElse(8),
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
