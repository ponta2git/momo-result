package momo.api.db

import cats.effect.{Async, Resource}
import doobie.hikari.HikariTransactor
import momo.api.config.DatabaseConfig

object Database:

  /**
   * Build a HikariTransactor[F] from a DatabaseConfig.
   *
   * Uses a single shared connection pool sized to `DatabaseConfig.poolSize`. The pool is closed
   * automatically when the resulting Resource is released.
   */
  def transactor[F[_]: Async](config: DatabaseConfig): Resource[F, HikariTransactor[F]] =
    HikariTransactor.newHikariTransactor[F](
      driverClassName = "org.postgresql.Driver",
      url = config.jdbcUrl,
      user = config.user,
      pass = config.password,
      connectEC = scala.concurrent.ExecutionContext.global,
    ).evalTap { xa =>
      xa.configure { ds =>
        Async[F].delay {
          ds.setMaximumPoolSize(config.poolSize)
          ds.setPoolName("momo-result-api")
        }
      }
    }
