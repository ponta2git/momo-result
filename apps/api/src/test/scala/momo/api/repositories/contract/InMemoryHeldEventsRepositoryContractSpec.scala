package momo.api.repositories.contract

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.adapters.InMemoryHeldEventsRepository
import momo.api.repositories.HeldEventsRepository

/**
 * Drives [[HeldEventsRepositoryContract]] against the in-memory adapter. A fresh `Ref`-backed
 * repository is built per test, so isolation comes for free.
 */
final class InMemoryHeldEventsRepositoryContractSpec
    extends CatsEffectSuite
    with HeldEventsRepositoryContract:

  override protected def freshRepo: IO[HeldEventsRepository[IO]] =
    InMemoryHeldEventsRepository.create[IO].map(repo => repo: HeldEventsRepository[IO])
