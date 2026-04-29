package momo.api.config

import cats.ApplicativeThrow
import cats.syntax.all.*

import java.nio.file.Path

final case class AppConfig(
    appEnv: AppEnv,
    httpHost: String,
    httpPort: Int,
    imageTmpDir: Path,
    devMemberIds: List[String]
)

enum AppEnv:
  case Dev, Test, Prod

object AppEnv:
  def fromString(value: String): Either[String, AppEnv] =
    value.toLowerCase match
      case "dev"  => Right(AppEnv.Dev)
      case "test" => Right(AppEnv.Test)
      case "prod" => Right(AppEnv.Prod)
      case other  => Left(s"Unsupported APP_ENV: $other")

object AppConfig:
  def load[F[_]: ApplicativeThrow]: F[AppConfig] =
    val env = sys.env
    val rawAppEnv = env.getOrElse("APP_ENV", "dev")
    AppEnv
      .fromString(rawAppEnv)
      .leftMap(new IllegalArgumentException(_))
      .liftTo[F]
      .map { appEnv =>
        AppConfig(
          appEnv = appEnv,
          httpHost = env.getOrElse("HTTP_HOST", "0.0.0.0"),
          httpPort = env.get("HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080),
          imageTmpDir =
            Path.of(env.getOrElse("IMAGE_TMP_DIR", "/tmp/momo-result/uploads")).toAbsolutePath,
          devMemberIds = env
            .get("DEV_MEMBER_IDS")
            .map(_.split(",").iterator.map(_.trim).filter(_.nonEmpty).toList)
            .getOrElse(List("ponta", "member-2", "member-3", "member-4"))
        )
      }
