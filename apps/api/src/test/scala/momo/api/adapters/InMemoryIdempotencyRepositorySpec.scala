package momo.api.adapters

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.repositories.IdempotencyRepository
import momo.api.repositories.contract.IdempotencyRepositoryContract

final class InMemoryIdempotencyRepositorySpec
    extends CatsEffectSuite with IdempotencyRepositoryContract:

  override protected def freshRepo: IO[IdempotencyRepository[IO]] = InMemoryIdempotencyRepository
    .create[IO].map(repo => repo: IdempotencyRepository[IO])
end InMemoryIdempotencyRepositorySpec
