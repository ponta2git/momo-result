package momo.api.db

import cats.effect.{Async, MonadCancelThrow, Resource}
import cats.syntax.all.*
import com.zaxxer.hikari.HikariConfig
import doobie.hikari.HikariTransactor
import doobie.implicits.*
import doobie.util.transactor.Transactor

import momo.api.config.DatabaseConfig

object Database:
  /** Doobie owns the pool and its matching bounded connection-acquisition executor. */
  def transactor[F[_]: Async](config: DatabaseConfig): Resource[F, HikariTransactor[F]] =
    Resource.eval(Async[F].delay {
      val pool = new HikariConfig()
      pool.setDriverClassName("org.postgresql.Driver")
      pool.setJdbcUrl(config.jdbcUrl)
      pool.setUsername(config.user)
      pool.setPassword(config.password)
      pool.setMaximumPoolSize(config.poolSize)
      // Open connections on demand; idle pools must not generate validation traffic.
      pool.setMinimumIdle(0)
      pool.setInitializationFailTimeout(-1L)
      pool.setKeepaliveTime(0L)
      pool.setIdleTimeout(600_000L)
      pool.setPoolName("momo-result-api")
      pool
    }).flatMap(HikariTransactor.fromHikariConfig[F](_))

  def ping[F[_]: MonadCancelThrow](xa: Transactor[F]): F[Unit] = sql"SELECT 1".query[Int].unique
    .transact(xa).void
end Database
