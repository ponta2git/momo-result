package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository

/**
 * Behaviour contract for [[HeldEventsRepository]] implementations.
 *
 * The same suite runs against the in-memory and the Postgres adapter to guarantee they share
 * observable behaviour. Tests intentionally avoid construction of dependent rows (game titles, map
 * masters, etc.) so the contract is portable and exercises only `held_events`-local semantics.
 *
 * Implementations are responsible for:
 *   - returning a fresh, empty repository per test (Postgres truncates in `beforeEach`,
 *     in-memory builds a new `Ref`);
 *   - making `freshRepo` lazy enough that a Postgres transactor is initialised before evaluation.
 */
trait HeldEventsRepositoryContract:
  this: CatsEffectSuite =>

  protected def freshRepo: IO[HeldEventsRepository[IO]]

  private val baseInstant: Instant = Instant.parse("2026-04-30T12:00:00Z")

  test("find returns None for an unknown id"):
    freshRepo.flatMap(_.find(HeldEventId.unsafeFromString("does_not_exist")))
      .map(r => assertEquals(r, None))

  test("create + find round-trips the held event"):
    val event = HeldEvent(HeldEventId.unsafeFromString("held_2026_04_30"), baseInstant)
    for
      repo <- freshRepo
      created <- repo.create(event)
      got <- repo.find(event.id)
    yield
      assertEquals(created, Right(()))
      assertEquals(got, Some(event))

  test("create rejects duplicate held event ids as a conflict"):
    val event = HeldEvent(HeldEventId.unsafeFromString("held_duplicate"), baseInstant)
    for
      repo <- freshRepo
      _ <- repo.create(event)
      duplicate <- repo.create(event)
    yield assertEquals(
      duplicate,
      Left(AppError.Conflict("held event already exists: held_duplicate")),
    )

end HeldEventsRepositoryContract
