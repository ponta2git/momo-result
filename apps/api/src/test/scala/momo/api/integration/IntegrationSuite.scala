package momo.api.integration

import java.util.concurrent.atomic.AtomicReference

import scala.concurrent.duration.DurationInt

import cats.effect.IO
import munit.{AnyFixture, CatsEffectSuite}

/**
 * Base for tests that hit the shared local Postgres at :5433.
 *
 * If the DB is unreachable the suite is skipped via `assume(false, ...)` on local machines, so it
 * can run safely without docker. In CI, an unreachable DB fails the suite because skipped DB-backed
 * tests are unverified.
 *
 * `unsafeRunSync` is permitted here because munit's lifecycle hooks (`beforeAll`/`afterAll`) are
 * `Unit`-returning and cannot accept an `IO`. Production code MUST NOT call `unsafeRunSync`.
 */
// scalafix:off DisableSyntax.noUnsafeRunSync
abstract class IntegrationSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds

  private def missingDbMessage: String =
    s"Integration Postgres is not reachable at ${IntegrationDb.settings.jdbcUrl}"

  protected val dbFixture: Fixture[IntegrationDb.DbFixture] =
    new Fixture[IntegrationDb.DbFixture]("momo-it-db"):
      private val holder = AtomicReference[Option[IntegrationDb.DbFixture]](None)
      def apply(): IntegrationDb.DbFixture = holder.get()
        .getOrElse(fail("DbFixture accessed before beforeAll"))
      override def beforeAll(): Unit =
        if !IntegrationDb.isAvailable then
          if IntegrationDb.isCi then fail(missingDbMessage)
          else
            // Defer skipping to per-test beforeEach via a flag, since beforeAll
            // throwing causes munit to mark the whole suite errored.
            holder.set(None)
        else
          import cats.effect.unsafe.implicits.global
          holder.set(Some(IntegrationDb.acquire.unsafeRunSync()))
      override def afterAll(): Unit =
        import cats.effect.unsafe.implicits.global
        holder.get().foreach(_.close().unsafeRunSync())
        holder.set(None)

  override def munitFixtures: Seq[AnyFixture[?]] = List(dbFixture)

  override def beforeEach(context: BeforeEach): Unit =
    super.beforeEach(context)
    if !IntegrationDb.isAvailable then
      if IntegrationDb.isCi then fail(missingDbMessage)
      else assume(false, s"$missingDbMessage; skipping")
    else
      import cats.effect.unsafe.implicits.global
      dbFixture().cleanup().unsafeRunSync()

  protected def transactor: doobie.Transactor[IO] = dbFixture().transactor
end IntegrationSuite
// scalafix:on DisableSyntax.noUnsafeRunSync
