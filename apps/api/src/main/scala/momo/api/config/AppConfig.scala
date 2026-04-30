package momo.api.config

import cats.syntax.all.*
import cats.MonadThrow
import java.nio.file.Path

final case class DatabaseConfig(jdbcUrl: String, user: String, password: String, poolSize: Int)

final case class AppConfig(
    appEnv: AppEnv,
    httpHost: String,
    httpPort: Int,
    imageTmpDir: Path,
    devMemberIds: List[String],
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
        loadDatabase[F](env, appEnv).map { database =>
          AppConfig(
            appEnv = appEnv,
            httpHost = env.getOrElse("HTTP_HOST", "0.0.0.0"),
            httpPort = env.get("HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080),
            imageTmpDir = Path.of(env.getOrElse("IMAGE_TMP_DIR", "/tmp/momo-result/uploads"))
              .toAbsolutePath,
            devMemberIds = env.get("DEV_MEMBER_IDS")
              .map(_.split(",").iterator.map(_.trim).filter(_.nonEmpty).toList)
              .getOrElse(DefaultDevMemberIds),
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
