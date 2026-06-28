package momo.api.config

import cats.MonadThrow
import cats.syntax.all.*

private[config] object DatabaseConfigLoader:
  def load[F[_]: MonadThrow](
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
          parsed <- DatabaseUrlConfig.toJdbcUrl(rawUrl).liftTo[F]
          (jdbcUrl, urlUser, urlPassword) = parsed
          safeJdbcUrl <- DatabaseUrlConfig.ensureProdSslMode(jdbcUrl, appEnv).liftTo[F]
          poolSize <- ConfigParsers.parsePositiveInt(env, "DB_POOL_SIZE", default = 2).liftTo[F]
        yield Some(DatabaseConfig(
          jdbcUrl = safeJdbcUrl,
          user = urlUser.orElse(env.get("DATABASE_USER").filter(_.nonEmpty)).getOrElse(""),
          password = urlPassword.orElse(env.get("DATABASE_PASSWORD").filter(_.nonEmpty))
            .getOrElse(""),
          poolSize = poolSize,
        ))

