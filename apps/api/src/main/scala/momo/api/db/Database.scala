package momo.api.db

import scala.util.control.NonFatal

import cats.effect.{Async, MonadCancelThrow, Resource}
import cats.syntax.all.*
import com.zaxxer.hikari.HikariConfig
import doobie.ConnectionIO
import doobie.hikari.HikariTransactor
import doobie.implicits.*
import doobie.util.transactor.Transactor
import org.postgresql.ds.PGSimpleDataSource

import momo.api.config.DatabaseConfig

object Database:
  // SET, unlike SELECT set_config(...), does not establish a snapshot before a repository's
  // SET TRANSACTION. Reapply inside every transaction so transaction-pooling proxies are safe.
  // Individual repositories may then narrow these bounds with their existing SET LOCAL calls.
  private val transactionTimeouts: ConnectionIO[Unit] =
    sql"""
      SET LOCAL statement_timeout = '60s';
      SET LOCAL lock_timeout = '5s';
      SET LOCAL idle_in_transaction_session_timeout = '30s'
    """.update.run.void

  /** Doobie owns the pool and its matching bounded connection-acquisition executor. */
  def transactor[F[_]: Async](config: DatabaseConfig): Resource[F, HikariTransactor[F]] =
    Resource.eval(postgresDataSource[F](config)).flatMap { postgres =>
      Resource.eval(Async[F].delay {
        val pool = new HikariConfig()
        pool.setDataSource(postgres)
        pool.setMaximumPoolSize(config.poolSize)
        pool.setConnectionTimeout(5_000L)
        pool.setValidationTimeout(2_000L)
        // Open connections on demand; idle pools must not generate validation traffic.
        pool.setMinimumIdle(0)
        pool.setInitializationFailTimeout(-1L)
        pool.setKeepaliveTime(0L)
        pool.setIdleTimeout(600_000L)
        pool.setPoolName("momo-result-api")
        pool
      }).flatMap(HikariTransactor.fromHikariConfig[F](_)).map { xa =>
        xa.copy(strategy0 = xa.strategy.copy(before = xa.strategy.before *> transactionTimeouts))
      }
    }

  private def postgresDataSource[F[_]: Async](config: DatabaseConfig): F[PGSimpleDataSource] =
    Async[F].delay {
      val postgres = new PGSimpleDataSource()
      // Parse first: URL properties otherwise override DataSource properties in pgJDBC.
      // Keep the driver's existing precedence for credentials supplied in the URL.
      postgres.setURL(config.jdbcUrl)
      postgres.setUser(Option(postgres.getUser).getOrElse(config.user))
      postgres.setPassword(Option(postgres.getPassword).getOrElse(config.password))
      postgres.setConnectTimeout(5)
      postgres.setLoginTimeout(5)
      postgres.setCancelSignalTimeout(5)
      // Server cancellation gets time to complete before a stalled socket is discarded.
      postgres.setSocketTimeout(65)
      postgres
    }.adaptError { case NonFatal(_) =>
      new IllegalArgumentException("Invalid database connection settings")
    }

  def ping[F[_]: MonadCancelThrow](xa: Transactor[F]): F[Unit] = sql"SELECT 1".query[Int].unique
    .transact(xa).void
end Database
