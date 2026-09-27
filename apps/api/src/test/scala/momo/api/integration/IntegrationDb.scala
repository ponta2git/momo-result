package momo.api.integration

import java.nio.file.{Files, Path, Paths}
import java.sql.DriverManager

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.hikari.HikariTransactor
import doobie.implicits.*
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName

import momo.api.config.DatabaseConfig
import momo.api.db.Database

/**
 * Helpers for integration tests that talk to an isolated Postgres Testcontainer migrated with the
 * momo-db drizzle SQL files selected by the shared pinned-migration resolver.
 *
 * The schema is owned by momo-db; tests must NOT issue DDL. Set `MOMO_DB_MIGRATIONS_DIR` when
 * an explicit migration snapshot is required instead of the pinned checkout.
 */
// scalafix:off DisableSyntax.noUnsafeRunSync
// scalafix:off DisableSyntax.throw
object IntegrationDb:

  private val PostgresImage = DockerImageName.parse("postgres:18-alpine")
  private val DatabaseName = "summit"
  private val Username = "summit"
  private val Password = "summit"
  private val StatementBreakpoint = raw"(?m)-->\s*statement-breakpoint\s*".r

  final case class Settings(jdbcUrl: String, user: String, password: String)

  /**
   * Suite-wide fixture combining a transactor with auto-cleanup before each test. Suites
   * acquire it through [[IntegrationDb.acquire]] in their `munitFixtures`.
   */
  final class DbFixture(
      val transactor: HikariTransactor[IO],
      val migratedNotificationSettings: List[(String, Boolean, Long)],
  ):
    def cleanup(): IO[Unit] = truncateAppTables(transactor)

  private lazy val sharedFixture: DbFixture =
    import cats.effect.unsafe.implicits.global

    val migrations = migrationFiles(migrationsDirectory)
    if migrations.isEmpty then sys.error("No momo-db migration SQL files found.")

    val container = new PostgreSQLContainer(PostgresImage).withDatabaseName(DatabaseName)
      .withUsername(Username).withPassword(Password)
    container.start()

    val settings = Settings(container.getJdbcUrl, container.getUsername, container.getPassword)
    try migrate(settings, migrations)
    catch
      case error: Throwable =>
        container.stop()
        throw error

    val (transactor, releaseTransactor) = transactorResource(settings).allocated.unsafeRunSync()
    val release = releaseTransactor >> IO.blocking(container.stop())
    val _ = sys.addShutdownHook(release.unsafeRunSync())
    val migratedNotificationSettings = sql"""
      SELECT kind, enabled, generation FROM discord_notification_settings ORDER BY kind
    """.query[(String, Boolean, Long)].to[List].transact(transactor).unsafeRunSync()
    new DbFixture(transactor, migratedNotificationSettings)

  def acquire: IO[DbFixture] = IO.blocking(sharedFixture)

  /**
   * Use the production pool setup. Three connections cover a lock holder, waiter,
   * and independent lock observer without making contention tests depend on elapsed time.
   */
  private def transactorResource(settings: Settings): Resource[IO, HikariTransactor[IO]] =
    Database.transactor[IO](DatabaseConfig(
      settings.jdbcUrl,
      settings.user,
      settings.password,
      poolSize = 3,
    ))

  private def migrate(settings: Settings, migrations: Seq[Path]): Unit =
    val connection = DriverManager.getConnection(settings.jdbcUrl, settings.user, settings.password)
    try
      connection.setAutoCommit(false)
      try
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
        connection.commit()
      catch
        case error: Throwable =>
          try connection.rollback()
          catch case rollbackError: Throwable => error.addSuppressed(rollbackError)
          throw error
    finally connection.close()

  private def migrationFiles(directory: Path): Seq[Path] =
    val stream = Files.list(directory)
    try stream.iterator().asScala
        .filter(path => path.getFileName.toString.matches("""\d{4}_.+\.sql""")).toSeq
        .sortBy(_.getFileName.toString)
    finally stream.close()

  private def migrationsDirectory: Path =
    val cwd = Paths.get(sys.props("user.dir")).toAbsolutePath.normalize()
    val resolver = Paths.get("scripts", "ci", "resolve-momo-db-migrations.sh")
    val root = Seq(cwd, cwd.resolve("../..").normalize())
      .find(path => Files.isRegularFile(path.resolve(resolver)))
      .getOrElse(throw new IllegalStateException("momo-db migration resolver was not found."))
    val process = new ProcessBuilder("bash", root.resolve(resolver).toString)
      .directory(cwd.toFile)
      .redirectError(ProcessBuilder.Redirect.INHERIT)
      .start()
    val output =
      val stream = process.getInputStream
      try new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)
          .stripSuffix("\n").stripSuffix("\r")
      finally stream.close()
    if process.waitFor() != 0 then
      throw new IllegalStateException(
        "momo-db migration path resolution failed; see resolver diagnostics."
      )
    val directory = Paths.get(output)
    if !directory.isAbsolute || !Files.isDirectory(directory) then
      throw new IllegalStateException(
        "momo-db migration resolver did not return an absolute directory."
      )
    directory

  /**
   * Wipe all app-owned tables so each test starts from a clean slate. Skips `members` (seeded by
   * momo-db migration `0009_seed_members.sql`), `momo_login_accounts` (seeded by migration
   * `0013_login_accounts.sql`), and `incident_masters` (seeded by migration). Order respects FK
   * dependencies; using TRUNCATE ... CASCADE keeps it terse.
   */
  def truncateAppTables(transactor: Transactor[IO]): IO[Unit] =
    (sql"""
      TRUNCATE TABLE
        discord_notifications,
        series_analysis_match_context_artifacts,
        series_analysis_drilldown_artifacts,
        series_analysis_scope_review_artifacts,
        series_analysis_scope_aggregate_artifacts,
        series_analysis_artifacts,
        series_analysis_queue_outbox,
        series_analysis_job_attempts,
        series_analysis_job_requests,
        series_analysis_jobs,
        series_analysis_campaign_targets,
        series_analysis_campaigns,
        series_analysis_operation_requests,
        series_analysis_reader_capabilities,
        series_analysis_worker_capabilities,
        match_incidents,
        match_players,
        match_drafts,
        matches,
        ocr_submission_members,
        ocr_submissions,
        ocr_queue_outbox,
        ocr_jobs,
        ocr_drafts,
        source_images,
        held_event_participants,
        held_events,
        member_aliases,
        season_masters,
        map_masters,
        game_titles,
        idempotency_keys,
        app_sessions
      RESTART IDENTITY CASCADE
    """.update.run.void *> sql"""
      UPDATE discord_notification_settings SET enabled = true, generation = 0
    """.update.run.void *> sql"""
      UPDATE worker_execution_slots
      SET task_kind = NULL,
          owner = NULL,
          job_id = NULL,
          attempt_id = NULL,
          holder_preemptible = NULL,
          lease_expires_at = NULL,
          preempt_requested_by = NULL,
          preempt_requested_at = NULL,
          updated_at = now()
      WHERE slot_key = 'shared-heavy-work'
    """.update.run.void *> sql"""
      UPDATE series_analysis_release_state
      SET algorithm_version = 'series-analysis-v5',
          artifact_schema_version = 4,
          validation_contract_id = 'series-analysis-artifact-v4-full-validation-v1',
          updated_at = clock_timestamp()
      WHERE singleton_key = 'current'
    """.update.run.void).transact(transactor)
end IntegrationDb
// scalafix:on DisableSyntax.throw
// scalafix:on DisableSyntax.noUnsafeRunSync
