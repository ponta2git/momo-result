package momo.api.integration

import cats.effect.IO

import momo.api.repositories.HeldEventsRepository
import momo.api.repositories.contract.HeldEventsRepositoryContract
import momo.api.repositories.postgres.PostgresHeldEventsRepository

/**
 * Drives [[HeldEventsRepositoryContract]] against the Postgres adapter.
 *
 * Per-test isolation comes from [[IntegrationSuite.beforeEach]], which truncates app-owned tables
 * (including `held_events`) before each test. `freshRepo` is `IO.delay` so the transactor fixture
 * is read after the suite's `beforeAll`/`beforeEach` have run.
 *
 * Skipped automatically when the local Postgres on :5433 is unavailable.
 */
final class PostgresHeldEventsRepositoryContractSpec
    extends IntegrationSuite
    with HeldEventsRepositoryContract:

  override protected def freshRepo: IO[HeldEventsRepository[IO]] =
    IO.delay(new PostgresHeldEventsRepository[IO](transactor))
