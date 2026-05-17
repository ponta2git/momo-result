package momo.api.db

import cats.effect.{Async, MonadCancelThrow, Resource}
import cats.syntax.all.*
import cats.~>
import doobie.ConnectionIO
import doobie.hikari.HikariTransactor
import doobie.implicits.*
import doobie.util.ExecutionContexts
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
   * automatically when the resulting Resource is released. Connection acquisition runs on a
   * dedicated bounded execution context so stalled JDBC connection setup cannot occupy Cats Effect
   * compute threads.
   */
  def transactor[F[_]: Async](config: DatabaseConfig): Resource[F, HikariTransactor[F]] =
    ExecutionContexts.fixedThreadPool[F](config.poolSize).flatMap { connectExecutionContext =>
      HikariTransactor.newHikariTransactor[F](
        driverClassName = "org.postgresql.Driver",
        url = config.jdbcUrl,
        user = config.user,
        pass = config.password,
        connectEC = connectExecutionContext,
      ).evalTap { transactor =>
        transactor.configure { ds =>
          Async[F].delay {
            ds.setMaximumPoolSize(config.poolSize)
            ds.setMinimumIdle(0)
            ds.setKeepaliveTime(60_000L)
            ds.setIdleTimeout(300_000L)
            ds.setPoolName("momo-result-api")
          }
        }
      }
    }

  def ping[F[_]: MonadCancelThrow](xa: Transactor[F]): F[Unit] = sql"SELECT 1".query[Int].unique
    .transact(xa).void
end Database
