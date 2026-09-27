package momo.api.integration

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.sql.{Connection, SQLException}

import scala.concurrent.duration.*

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.util.transactor.Strategy
import doobie.{ConnectionIO, Transactor}
import org.postgresql.ds.PGSimpleDataSource

import momo.api.config.DatabaseConfig
import momo.api.db.Database

final class DatabaseConnectionLimitsSpec extends IntegrationSuite:
  private val defaults = ("1min", "5s", "30s")
  private val sessionDefaults = ("0", "0", "0")

  private val timeouts: ConnectionIO[(String, String, String)] =
    for
      statement <- sql"SHOW statement_timeout".query[String].unique
      lock <- sql"SHOW lock_timeout".query[String].unique
      idle <- sql"SHOW idle_in_transaction_session_timeout".query[String].unique
    yield (statement, lock, idle)

  private val narrowTimeouts: ConnectionIO[Unit] =
    sql"""SET LOCAL statement_timeout = '2s';
          SET LOCAL lock_timeout = '250ms';
          SET LOCAL idle_in_transaction_session_timeout = '10s'""".update.run.void

  test("production pools enforce finite transport and acquisition limits despite URL zero values") {
    for
      config <- IO.blocking {
        val original = dbFixture().transactor.kernel.getDataSource
          .unwrap(classOf[PGSimpleDataSource])
        val separator = if original.getURL.contains("?") then "&" else "?"
        val url = original.getURL + separator +
          "connectTimeout=0&loginTimeout=0&cancelSignalTimeout=0&socketTimeout=0" +
          "&user=" + URLEncoder.encode(original.getUser, StandardCharsets.UTF_8) +
          "&password=" + URLEncoder.encode(original.getPassword, StandardCharsets.UTF_8)
        val unrestricted = new PGSimpleDataSource()
        unrestricted.setURL(url)
        assertEquals(
          (
            unrestricted.getConnectTimeout,
            unrestricted.getLoginTimeout,
            unrestricted.getCancelSignalTimeout,
            unrestricted.getSocketTimeout
          ),
          (0, 0, 0, 0),
        )
        // A successful connection also proves that URL credentials retain driver precedence.
        DatabaseConfig(url, "invalid-fixture-user", "invalid-fixture-password", poolSize = 1)
      }
      _ <- Database.transactor[IO](config).use { xa =>
        for
          limits <- IO.blocking {
            val postgres = xa.kernel.getDataSource.unwrap(classOf[PGSimpleDataSource])
            (
              postgres.getConnectTimeout,
              postgres.getLoginTimeout,
              postgres.getCancelSignalTimeout,
              postgres.getSocketTimeout,
              xa.kernel.getConnectionTimeout,
              xa.kernel.getValidationTimeout,
            )
          }
          settings <- timeouts.transact(xa)
        yield
          assertEquals(limits, (5, 5, 5, 65, 5000L, 2000L))
          assertEquals(settings, defaults)
      }
    yield ()
  }

  test("local limits precede snapshot setup and reset after commit on the same connection") {
    withConnection { (connection, xa) =>
      for
        before <- outsideTransaction(connection)
        first <- (for
          _ <- sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run
          isolation <- sql"SHOW transaction_isolation".query[String].unique
          readOnly <- sql"SHOW transaction_read_only".query[String].unique
          applied <- timeouts
          _ <- narrowTimeouts
          narrowed <- timeouts
        yield (isolation, readOnly, applied, narrowed)).transact(xa)
        after <- outsideTransaction(connection)
        next <- timeouts.transact(xa)
      yield
        assertEquals(before, sessionDefaults)
        assertEquals(first, ("repeatable read", "on", defaults, ("2s", "250ms", "10s")))
        assertEquals(after, sessionDefaults)
        assertEquals(next, defaults)
    }
  }

  test("a narrowed statement timeout aborts SQL, rolls back writes, and resets for reuse") {
    withConnection { (connection, xa) =>
      for
        rejected <- (for
          _ <- sql"SET LOCAL statement_timeout = '100ms'".update.run
          _ <- insertEvent("bounds_statement")
          _ <- sql"SELECT pg_sleep(10)".query[Unit].unique
        yield ()).transact(xa).attempt.timeout(5.seconds)
        after <- outsideTransaction(connection)
        next <- (timeouts, eventCount("bounds_statement")).tupled.transact(xa)
      yield
        assertSqlState(rejected, "57014")
        assertEquals(after, sessionDefaults)
        assertEquals(next, (defaults, 0L))
    }
  }

  test("the production lock deadline bounds contention and the connection remains reusable") {
    val lockKey = 720061L
    withConnection { (connection, xa) =>
      for
        rejected <- advisoryLock(lockKey).use { blocker =>
          (insertEvent("bounds_lock") *>
            sql"SELECT pg_advisory_xact_lock($lockKey)".query[Unit].unique)
            .transact(xa).attempt.background.use { completed =>
              awaitBackendBlockedBy(blocker) *> completed.flatMap(_.embedNever)
            }.timeout(10.seconds)
        }
        after <- outsideTransaction(connection)
        next <- (timeouts, eventCount("bounds_lock")).tupled.transact(xa)
      yield
        assertSqlState(rejected, "55P03")
        assertEquals(after, sessionDefaults)
        assertEquals(next, (defaults, 0L))
    }
  }

  test("canceling a PostgreSQL query rolls back writes and local limits before connection reuse") {
    withConnection { (connection, xa) =>
      for
        pid <- sql"SELECT pg_backend_pid()".query[Int].unique.transact(xa)
        outcome <- Resource.make((for
          _ <- narrowTimeouts
          _ <- sql"SET LOCAL statement_timeout = '10s'".update.run
          _ <- insertEvent("bounds_cancel")
          _ <- sql"SELECT pg_sleep(20)".query[Unit].unique
        yield ()).transact(xa).start)(_.cancel).use { running =>
          awaitSleepingQuery(pid) *> running.cancel.timeout(5.seconds) *> running.join
        }
        after <- outsideTransaction(connection)
        next <- (timeouts, eventCount("bounds_cancel")).tupled.transact(xa)
      yield
        assert(outcome.isCanceled)
        assertEquals(after, sessionDefaults)
        assertEquals(next, (defaults, 0L))
    }
  }

  private def withConnection[A](run: (Connection, Transactor[IO]) => IO[A]): IO[A] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection())).use { connection =>
      // Keep the physical connection and the actual production strategy across all outcomes.
      val xa = Transactor.fromConnection[IO](connection, None)
        .copy(strategy0 = transactor.strategy)
      run(connection, xa)
    }

  private def outsideTransaction(connection: Connection): IO[(String, String, String)] =
    IO.blocking(connection.setAutoCommit(true)) *> timeouts.transact(
      Transactor.fromConnection[IO](connection, None).copy(strategy0 = Strategy.void)
    )

  private def advisoryLock(key: Long): Resource[IO, Int] = Resource
    .fromAutoCloseable(IO.blocking(dataSource.getConnection())).flatMap { connection =>
      Resource.make(IO.blocking(connection.setAutoCommit(false)))(_ =>
        IO.blocking(connection.rollback())
      ).evalMap { _ =>
        (sql"SELECT pg_advisory_xact_lock($key)".query[Unit].unique *>
          sql"SELECT pg_backend_pid()".query[Int].unique).transact(
          Transactor.fromConnection[IO](connection, None).copy(strategy0 = Strategy.void)
        )
      }
    }

  private def awaitSleepingQuery(pid: Int): IO[Unit] =
    val observe = sql"""SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE pid = $pid AND wait_event = 'PgSleep'
    )""".query[Boolean].unique.transact(transactor)
    def poll: IO[Unit] = observe.flatMap {
      case true => IO.unit
      case false => IO.cede *> IO.defer(poll)
    }
    poll.timeout(5.seconds)

  private def insertEvent(id: String): ConnectionIO[Unit] =
    sql"""INSERT INTO held_events (id, held_date_iso, start_at)
      VALUES ($id, CURRENT_DATE, CURRENT_TIMESTAMP)""".update.run.void

  private def eventCount(id: String): ConnectionIO[Long] =
    sql"SELECT COUNT(*) FROM held_events WHERE id = $id".query[Long].unique

  private def assertSqlState[A](result: Either[Throwable, A], expected: String): Unit = result match
    case Left(error: SQLException) => assertEquals(error.getSQLState, expected)
    case _ => fail(s"expected PostgreSQL SQLSTATE $expected")
