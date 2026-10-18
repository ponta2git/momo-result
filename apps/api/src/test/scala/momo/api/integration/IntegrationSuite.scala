package momo.api.integration

import java.util.concurrent.atomic.AtomicReference

import scala.concurrent.duration.DurationInt

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*
import munit.AnyFixture

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.postgres.PostgresIdentities
import momo.api.testing.TestTags

/**
 * Base for tests that hit an isolated Postgres Testcontainer migrated with momo-db SQL.
 *
 * The Testcontainer and migrated schema are shared by all DB integration suites in the forked test
 * JVM. Each DB test configuration owns one forked JVM, container and migration sequence.
 *
 * `unsafeRunSync` is permitted here because munit's lifecycle hooks (`beforeAll`/`afterAll`) are
 * `Unit`-returning and cannot accept an `IO`. Production code MUST NOT call `unsafeRunSync`.
 */
// scalafix:off DisableSyntax.noUnsafeRunSync
abstract class IntegrationSuite extends MomoCatsEffectSuite:
  protected def databaseTag: munit.Tag = TestTags.DbIntegration
  protected def identitySchema: PostgresIdentities = PostgresIdentities.Legacy
  protected given identityMode: PostgresIdentities = identitySchema

  override def munitTests(): Seq[munit.Test] = super.munitTests()
    .map(_.tag(databaseTag))

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

  protected def insertOcrSourceImage(id: String, now: java.time.Instant): IO[Int] = sql"""
    INSERT INTO source_images (
      id, owner_account_id, object_key, idempotency_key_hash, status,
      media_type, byte_length, sha256_hex, width, height, available_at, created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', ${s"source-images/$id.png"}, md5($id) || md5($id), 'AVAILABLE',
      'image/png', 128, repeat('b', 64), 1, 1, $now, $now, $now
    ) ON CONFLICT (id) DO NOTHING
  """.update.run.transact(transactor)

  /** Observe the transaction used by the public read facade before its normal commit. */
  protected def assertReadSnapshot[A](read: doobie.Transactor[IO] => IO[A]): IO[A] =
    val after =
      for
        isolation <- sql"SHOW transaction_isolation".query[String].unique
        readOnly <- sql"SHOW transaction_read_only".query[String].unique
        _ <- doobie.free.connection.delay {
          assertEquals(isolation, "repeatable read")
          assertEquals(readOnly, "on")
        }
        _ <- doobie.free.connection.commit
      yield ()
    read(doobie.Transactor.after.set(transactor, after))

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
