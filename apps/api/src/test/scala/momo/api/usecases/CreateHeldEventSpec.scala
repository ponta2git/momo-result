package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.InMemoryHeldEventsRepository
import momo.api.domain.ids.HeldEventId
import momo.api.testing.AppErrorAssertions.assertAppError

final class CreateHeldEventSpec extends MomoCatsEffectSuite:
  private val heldAt = Instant.parse("2026-05-20T12:00:00Z")
  private val heldEventId = HeldEventId.unsafeFromString("held_duplicate_usecase")

  test("returns Conflict when the repository rejects a generated duplicate id"):
    for
      events <- InMemoryHeldEventsRepository.create[IO]
      usecase = CreateHeldEvent[IO](events, IO.pure(heldEventId))
      first <- usecase.run(CreateHeldEventCommand(heldAt))
      duplicate <- usecase.run(CreateHeldEventCommand(heldAt.plusSeconds(60)))
    yield
      assertEquals(first.map(_.id), Right(heldEventId))
      assertAppError(duplicate, "CONFLICT", "held event already exists")
