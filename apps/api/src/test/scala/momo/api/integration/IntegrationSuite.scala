package momo.api.integration

import java.util.concurrent.atomic.AtomicReference

import scala.concurrent.duration.DurationInt

import cats.effect.IO
import doobie.implicits.*
import munit.{AnyFixture, CatsEffectSuite}

import momo.api.testing.TestTags

/**
 * Base for tests that hit an isolated Postgres Testcontainer migrated with momo-db SQL.
 *
 * The Testcontainer and migrated schema are shared by all DB integration suites in the forked test
 * JVM. `apiDbQuality` runs these suites in a single forked JVM so container startup and migration
 * happen once per quality gate.
 *
 * `unsafeRunSync` is permitted here because munit's lifecycle hooks (`beforeAll`/`afterAll`) are
 * `Unit`-returning and cannot accept an `IO`. Production code MUST NOT call `unsafeRunSync`.
 */
// scalafix:off DisableSyntax.noUnsafeRunSync
abstract class IntegrationSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds

  override def munitTests(): Seq[munit.Test] = super.munitTests()
    .map(_.tag(TestTags.DbIntegration))

  protected val dbFixture: Fixture[IntegrationDb.DbFixture] =
    new Fixture[IntegrationDb.DbFixture]("momo-it-db"):
      private val holder = AtomicReference[Option[IntegrationDb.DbFixture]](None)
      def apply(): IntegrationDb.DbFixture = holder.get()
        .getOrElse(fail("DbFixture accessed before beforeAll"))
      override def beforeAll(): Unit =
        import cats.effect.unsafe.implicits.global
        holder.set(Some(IntegrationDb.acquire.unsafeRunSync()))
      override def afterAll(): Unit =
        holder.set(None)

  override def munitFixtures: Seq[AnyFixture[?]] = List(dbFixture)

  override def beforeEach(context: BeforeEach): Unit =
    super.beforeEach(context)
    import cats.effect.unsafe.implicits.global
    dbFixture().cleanup().unsafeRunSync()

  protected def transactor: doobie.Transactor[IO] = dbFixture().transactor
  protected def dataSource: javax.sql.DataSource = dbFixture().transactor.kernel

  /** Wait until PostgreSQL, rather than elapsed wall time, confirms a backend is lock-blocked. */
  protected def awaitBackendBlockedBy(blockerPid: Int): IO[Unit] =
    val observe = sql"""
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE $blockerPid = ANY(pg_blocking_pids(pid))
      )
    """.query[Boolean].unique.transact(transactor)

    def poll: IO[Unit] = observe.flatMap {
      case true => IO.unit
      case false => IO.cede *> IO.defer(poll)
    }

    poll.timeoutTo(
      5.seconds,
      IO.raiseError(
        new AssertionError(s"no backend became blocked by PostgreSQL backend $blockerPid")
      ),
    )
end IntegrationSuite
// scalafix:on DisableSyntax.noUnsafeRunSync
