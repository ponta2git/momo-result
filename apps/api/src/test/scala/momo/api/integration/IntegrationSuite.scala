package momo.api.integration

import java.util.concurrent.atomic.AtomicReference

import scala.concurrent.duration.DurationInt

import cats.effect.IO
import munit.{AnyFixture, CatsEffectSuite}

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
  private val Integration = new munit.Tag("Integration")

  override def munitIOTimeout = 30.seconds

  override def munitTests(): Seq[munit.Test] = super.munitTests().map(_.tag(Integration))

  protected val dbFixture: Fixture[IntegrationDb.DbFixture] =
    new Fixture[IntegrationDb.DbFixture]("momo-it-db"):
      private val holder = AtomicReference[Option[IntegrationDb.DbFixture]](None)
      def apply(): IntegrationDb.DbFixture = holder.get()
        .getOrElse(fail("DbFixture accessed before beforeAll"))
      override def beforeAll(): Unit =
        import cats.effect.unsafe.implicits.global
        holder.set(Some(IntegrationDb.acquire.unsafeRunSync()))
      override def afterAll(): Unit =
        import cats.effect.unsafe.implicits.global
        holder.get().foreach(_.close().unsafeRunSync())
        holder.set(None)

  override def munitFixtures: Seq[AnyFixture[?]] = List(dbFixture)

  override def beforeEach(context: BeforeEach): Unit =
    super.beforeEach(context)
    import cats.effect.unsafe.implicits.global
    dbFixture().cleanup().unsafeRunSync()

  protected def transactor: doobie.Transactor[IO] = dbFixture().transactor
end IntegrationSuite
// scalafix:on DisableSyntax.noUnsafeRunSync
