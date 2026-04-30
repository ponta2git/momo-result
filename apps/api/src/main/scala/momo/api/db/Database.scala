package momo.api.db

import cats.effect.{Async, Resource}
import doobie.hikari.HikariTransactor
import momo.api.config.DatabaseConfig
import scala.concurrent.ExecutionContext

object Database:

  /**
   * Build a HikariTransactor[F] from a DatabaseConfig.
   *
   * Uses a single shared connection pool sized to `DatabaseConfig.poolSize`. The pool is closed
   * automatically when the resulting Resource is released.
   */
  def transactor[F[_]: Async](
      config: DatabaseConfig,
      connectExecutionContext: ExecutionContext,
  ): Resource[F, HikariTransactor[F]] = HikariTransactor.newHikariTransactor[F](
    driverClassName = "org.postgresql.Driver",
    url = config.jdbcUrl,
    user = config.user,
    pass = config.password,
    connectEC = connectExecutionContext,
  ).evalTap { transactor =>
    transactor.configure { ds =>
      Async[F].delay {
        ds.setMaximumPoolSize(config.poolSize)
        ds.setPoolName("momo-result-api")
      }
    }
  }
