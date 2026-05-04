package momo.api.db

import scala.concurrent.ExecutionContext

import cats.effect.{Async, MonadCancelThrow, Resource}
import cats.~>
import doobie.ConnectionIO
import doobie.hikari.HikariTransactor
import doobie.util.transactor.Transactor

import momo.api.config.DatabaseConfig

object Database:

  /**
   * Natural transformation `ConnectionIO ~> F` produced by a [[Transactor]].
   *
   * Each evaluation runs its argument inside a fresh JDBC transaction. Phase 3 repositories use
   * this to keep `Alg[ConnectionIO]` tx-agnostic and let the repository facade decide where the tx
   * boundary lives.
   */
  def transactK[F[_]: MonadCancelThrow](xa: Transactor[F]): ConnectionIO ~> F =
    new (ConnectionIO ~> F):
      def apply[A](fa: ConnectionIO[A]): F[A] = xa.trans.apply(fa)

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
end Database
