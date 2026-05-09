package momo.api.integration

import java.nio.file.{Files, Path, Paths}
import java.sql.DriverManager

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import com.zaxxer.hikari.HikariConfig
import doobie.*
import doobie.hikari.HikariTransactor
import doobie.implicits.*
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName

/**
 * Helpers for integration tests that talk to an isolated Postgres Testcontainer migrated with the
 * momo-db drizzle SQL files.
 *
 * The schema is owned by momo-db; tests must NOT issue DDL. Set `MOMO_DB_MIGRATIONS_DIR` when the
 * momo-db checkout is not discoverable from the current working directory.
 */
// scalafix:off DisableSyntax.noUnsafeRunSync
// scalafix:off DisableSyntax.throw
object IntegrationDb:

  private val PostgresImage = DockerImageName.parse("postgres:16-alpine")
  private val DatabaseName = "summit"
  private val Username = "summit"
  private val Password = "summit"
  private val StatementBreakpoint = raw"(?m)-->\s*statement-breakpoint\s*".r

  private final class MomoPostgresContainer
      extends PostgreSQLContainer[MomoPostgresContainer](PostgresImage)

  final case class Settings(jdbcUrl: String, user: String, password: String)

  /**
   * Suite-wide fixture combining a transactor with auto-cleanup before each test. Suites
   * instantiate via [[withDb]] in their `munitFixtures`.
   */
  final class DbFixture(
      val settings: Settings,
      val transactor: HikariTransactor[IO],
      release: IO[Unit],
  ):
    def cleanup(): IO[Unit] = truncateAppTables(transactor)
    def close(): IO[Unit] = release

  private lazy val sharedFixture: DbFixture =
    import cats.effect.unsafe.implicits.global

    val container = new MomoPostgresContainer().withDatabaseName(DatabaseName)
      .withUsername(Username).withPassword(Password)
    container.start()

    val settings = Settings(container.getJdbcUrl, container.getUsername, container.getPassword)
    try migrate(settings)
    catch
      case error: Throwable =>
        container.stop()
        throw error

    val (transactor, releaseTransactor) = transactorResource(settings).allocated.unsafeRunSync()
    val release = releaseTransactor >> IO.blocking(container.stop())
    val _ = sys.addShutdownHook(release.unsafeRunSync())
    new DbFixture(settings, transactor, IO.unit)

  def acquire: IO[DbFixture] = IO.blocking(sharedFixture)

  /**
   * Build a HikariCP-backed transactor for tests. Uses a tiny pool to keep concurrency predictable.
   */
  private def transactorResource(settings: Settings): Resource[IO, HikariTransactor[IO]] =
    val cfg = new HikariConfig()
    cfg.setJdbcUrl(settings.jdbcUrl)
    cfg.setUsername(settings.user)
    cfg.setPassword(settings.password)
    cfg.setMaximumPoolSize(2)
    cfg.setMinimumIdle(0)
    cfg.setPoolName("momo-result-it")
    HikariTransactor.fromHikariConfig[IO](cfg)

  private def migrate(settings: Settings): Unit =
    val migrations = migrationFiles(migrationsDirectory)
    if migrations.isEmpty then sys.error("No momo-db migration SQL files found.")

    Class.forName("org.postgresql.Driver")
    val connection = DriverManager.getConnection(settings.jdbcUrl, settings.user, settings.password)
    try
      connection.setAutoCommit(true)
      migrations.foreach { path =>
        val sql = Files.readString(path)
        StatementBreakpoint.split(sql).iterator.map(_.trim).filter(_.nonEmpty).foreach {
          statementSql =>
            val statement = connection.createStatement()
            try statement.execute(statementSql)
            catch
              case error: Throwable => throw new RuntimeException(
                  s"Failed to apply momo-db migration ${path.getFileName}",
                  error,
                )
            finally statement.close()
        }
      }
    finally connection.close()

  private def migrationFiles(directory: Path): Seq[Path] =
    val stream = Files.list(directory)
    try stream.iterator().asScala
        .filter(path => path.getFileName.toString.matches("""\d{4}_.+\.sql""")).toSeq
        .sortBy(_.getFileName.toString)
    finally stream.close()

  private def migrationsDirectory: Path =
    val explicit = sys.env.get("MOMO_DB_MIGRATIONS_DIR")
      .map(Paths.get(_).toAbsolutePath.normalize())
    explicit.getOrElse {
      val cwd = Paths.get(sys.props("user.dir")).toAbsolutePath.normalize()
      val candidates = Seq(
        cwd.resolve("../../_deps/momo-db/drizzle"),
        cwd.resolve("_deps/momo-db/drizzle"),
        cwd.resolve("../../../momo-db/drizzle"),
        cwd.resolve("../momo-db/drizzle"),
      ).map(_.normalize())
      candidates.find(Files.isDirectory(_)).getOrElse {
        val searched = candidates.mkString(", ")
        throw new IllegalStateException(
          s"momo-db migrations directory was not found. Set MOMO_DB_MIGRATIONS_DIR. Searched: $searched"
        )
      }
    }

  /**
   * Wipe all app-owned tables so each test starts from a clean slate. Skips `members` (seeded by
   * momo-db migration `0009_seed_members.sql`), `momo_login_accounts` (seeded by migration
   * `0013_login_accounts.sql`), and `incident_masters` (seeded by migration). Order respects FK
   * dependencies; using TRUNCATE ... CASCADE keeps it terse.
   */
  def truncateAppTables(transactor: Transactor[IO]): IO[Unit] = sql"""
      TRUNCATE TABLE
        match_incidents,
        match_players,
        match_drafts,
        matches,
        ocr_queue_outbox,
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
end IntegrationDb
// scalafix:on DisableSyntax.throw
// scalafix:on DisableSyntax.noUnsafeRunSync
