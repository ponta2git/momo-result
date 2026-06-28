package momo.api.config

import java.nio.file.Path

import cats.effect.Async
import cats.syntax.all.*
import ciris.{ConfigValue, Effect}

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

  def load[F[_]: Async]: F[AppConfig] = loadFromEnv(sys.env)

  private final case class BaseConfigInput(
      rawAppEnv: String,
      httpHost: String,
      httpPort: Int,
      imageTmpDir: String,
      rawDevMemberIds: Option[String],
  )

  private[config] def loadFromEnv[F[_]: Async](env: Map[String, String]): F[AppConfig] =
    baseConfig(env).load[F].flatMap { base =>
      AppEnv.fromString(base.rawAppEnv).leftMap(new IllegalArgumentException(_)).liftTo[F]
        .flatMap { appEnv =>
          (
            DatabaseConfigLoader.load[F](env, appEnv),
            RedisConfigLoader.load[F](env, appEnv),
            AuthConfigLoader.load[F](env, appEnv),
            ResourceLimitsConfigLoader.load[F](env),
          ).mapN { (database, redis, auth, resourceLimits) =>
            AppConfig(
              appEnv = appEnv,
              httpHost = base.httpHost,
              httpPort = base.httpPort,
              imageTmpDir = Path.of(base.imageTmpDir).toAbsolutePath,
              devMemberIds = base.rawDevMemberIds.map(parseDevMemberIds).getOrElse(
                DefaultDevMemberIds
              ),
              auth = auth,
              resourceLimits = resourceLimits,
              database = database,
              redis = redis,
            )
          }
        }
    }

  private def baseConfig(env: Map[String, String]): ConfigValue[Effect, BaseConfigInput] =
    (
      ConfigParsers.envValue(env, "APP_ENV").default("dev"),
      ConfigParsers.envValue(env, "HTTP_HOST").default("0.0.0.0"),
      ConfigParsers.parsePort(env, "HTTP_PORT", default = 8080),
      ConfigParsers.envValue(env, "IMAGE_TMP_DIR").default("/tmp/momo-result/uploads"),
      ConfigParsers.envValue(env, "DEV_MEMBER_IDS").option,
    ).parMapN(BaseConfigInput.apply)

  private def parseDevMemberIds(value: String): List[String] =
    value.split(",").iterator.map(_.trim).filter(_.nonEmpty).toList
