package momo.api.integration

import cats.effect.IO

import momo.api.repositories.IdempotencyRepository
import momo.api.repositories.contract.IdempotencyRepositoryContract
import momo.api.repositories.postgres.PostgresIdempotencyRepository

/**
 * Drives [[IdempotencyRepositoryContract]] against the Postgres adapter.
 *
 * Per-test isolation comes from [[IntegrationSuite.beforeEach]], which truncates `idempotency_keys`
 * before each test. `freshRepo` is `IO.delay` so the transactor fixture is read after the suite's
 * `beforeAll`/`beforeEach` have run.
 */
final class PostgresIdempotencyRepositoryContractSpec
    extends IntegrationSuite with IdempotencyRepositoryContract:

  override protected def freshRepo: IO[IdempotencyRepository[IO]] = IO
    .delay(new PostgresIdempotencyRepository[IO](transactor))
end PostgresIdempotencyRepositoryContractSpec
