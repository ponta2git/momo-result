package momo.api.integration

import cats.effect.IO
import munit.AnyFixture
import munit.CatsEffectSuite

import scala.concurrent.duration.DurationInt

/** Base for tests that hit the shared local Postgres at :5433.
  *
  * If the DB is unreachable the suite is skipped via `assume(false, ...)` in
  * `beforeAll`, so it can run safely on dev machines without docker.
  */
abstract class IntegrationSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds

  protected val dbFixture: Fixture[IntegrationDb.DbFixture] =
    new Fixture[IntegrationDb.DbFixture]("momo-it-db"):
      private var holder: Option[IntegrationDb.DbFixture] = None
      def apply(): IntegrationDb.DbFixture =
        holder.getOrElse(
          throw new IllegalStateException("DbFixture accessed before beforeAll")
        )
      override def beforeAll(): Unit =
        if !IntegrationDb.isAvailable then
          // Defer skipping to per-test beforeEach via a flag, since beforeAll
          // throwing causes munit to mark the whole suite errored.
          holder = None
        else
          import cats.effect.unsafe.implicits.global
          holder = Some(IntegrationDb.acquire.unsafeRunSync())
      override def afterAll(): Unit =
        import cats.effect.unsafe.implicits.global
        holder.foreach(_.close().unsafeRunSync())
        holder = None

  override def munitFixtures: Seq[AnyFixture[?]] = List(dbFixture)

  override def beforeEach(context: BeforeEach): Unit =
    super.beforeEach(context)
    if !IntegrationDb.isAvailable then
      assume(false, "Integration Postgres at :5433 is not reachable; skipping")
    else
      import cats.effect.unsafe.implicits.global
      dbFixture().cleanup().unsafeRunSync()

  protected def xa: doobie.Transactor[IO] = dbFixture().xa
end IntegrationSuite
