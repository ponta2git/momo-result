package momo.api.config

import java.nio.file.Path

import cats.MonadThrow
import cats.syntax.all.*

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

object AppConfig:
  private val DefaultDevMemberIds: List[String] =
    List("member_ponta", "member_akane_mami", "member_otaka", "member_eu")

  def load[F[_]: MonadThrow]: F[AppConfig] = loadFromEnv(sys.env)

  private[config] def loadFromEnv[F[_]: MonadThrow](env: Map[String, String]): F[AppConfig] =
    val rawAppEnv = env.getOrElse("APP_ENV", "dev")
    AppEnv.fromString(rawAppEnv).leftMap(new IllegalArgumentException(_)).liftTo[F]
      .flatMap { appEnv =>
        (
          DatabaseConfigLoader.load[F](env, appEnv),
          RedisConfigLoader.load[F](env, appEnv),
          AuthConfigLoader.load[F](env, appEnv),
          ResourceLimitsConfigLoader.load[F](env),
          ConfigParsers.parsePort(env, "HTTP_PORT", default = 8080).liftTo[F],
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
