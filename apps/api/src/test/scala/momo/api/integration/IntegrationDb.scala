package momo.api.integration

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import com.zaxxer.hikari.HikariConfig
import doobie.*
import doobie.hikari.HikariTransactor
import doobie.implicits.*

/**
 * Helpers for integration tests that talk to the shared local Postgres provisioned by
 * `~/Documents/codes/momo-db` (`pnpm db:up && pnpm db:migrate`).
 *
 * Defaults match `compose.yaml` in momo-db:
 *   - host=localhost, port=5433, db=summit, user=summit, password=summit
 *
 * Override via env var `MOMO_RESULT_TEST_DATABASE_URL` (full JDBC URL), `MOMO_RESULT_TEST_DB_USER`,
 * `MOMO_RESULT_TEST_DB_PASSWORD`.
 *
 * The schema is owned by momo-db; tests must NOT issue DDL.
 */
object IntegrationDb:

  final case class Settings(jdbcUrl: String, user: String, password: String)

  def isCi: Boolean = sys.env.get("CI").exists(_.equalsIgnoreCase("true"))

  def settings: Settings =
    val jdbcUrl = sys.env
      .getOrElse("MOMO_RESULT_TEST_DATABASE_URL", "jdbc:postgresql://localhost:5433/summit")
    val user = sys.env.getOrElse("MOMO_RESULT_TEST_DB_USER", "summit")
    val password = sys.env.getOrElse("MOMO_RESULT_TEST_DB_PASSWORD", "summit")
    Settings(jdbcUrl, user, password)

  /**
   * Quick liveness probe used by suites to skip themselves when no DB is available (e.g. on CI
   * without docker or local dev without `pnpm db:up`).
   */
  def isAvailable: Boolean =
    try
      Class.forName("org.postgresql.Driver")
      val s = settings
      val c = java.sql.DriverManager.getConnection(s.jdbcUrl, s.user, s.password)
      try
        val st = c.createStatement()
        try
          val rs = st.executeQuery("SELECT 1")
          rs.next()
        finally st.close()
      finally c.close()
      true
    catch case _: Throwable => false

  /**
   * Build a HikariCP-backed transactor for tests. Uses a tiny pool to keep concurrency predictable.
   */
  def transactor: Resource[IO, HikariTransactor[IO]] =
    val s = settings
    val cfg = new HikariConfig()
    cfg.setJdbcUrl(s.jdbcUrl)
    cfg.setUsername(s.user)
    cfg.setPassword(s.password)
    cfg.setMaximumPoolSize(2)
    cfg.setMinimumIdle(0)
    cfg.setPoolName("momo-result-it")
    HikariTransactor.fromHikariConfig[IO](cfg)

  /**
   * Wipe all app-owned tables so each test starts from a clean slate. Skips `members` (seeded by
   * momo-db migration `0009_seed_members.sql`) and `incident_masters` (seeded by drizzle
   * migration). Order respects FK dependencies; using TRUNCATE ... CASCADE keeps it terse.
   */
  def truncateAppTables(transactor: Transactor[IO]): IO[Unit] = sql"""
      TRUNCATE TABLE
        match_incidents,
        match_players,
        match_drafts,
        matches,
        ocr_jobs,
        ocr_drafts,
        held_event_participants,
        held_events,
        member_aliases,
        season_masters,
        map_masters,
        game_titles,
        idempotency_keys,
        app_sessions
      RESTART IDENTITY CASCADE
    """.update.run.void.transact(transactor)

  /**
   * Suite-wide fixture combining a transactor with auto-cleanup before each test. Suites
   * instantiate via [[withDb]] in their `munitFixtures`.
   */
  final class DbFixture(val transactor: HikariTransactor[IO], release: IO[Unit]):
    def cleanup(): IO[Unit] = truncateAppTables(transactor)
    def close(): IO[Unit] = release

  def acquire: IO[DbFixture] = transactor.allocated.map { case (transactor, release) =>
    new DbFixture(transactor, release)
  }
end IntegrationDb
