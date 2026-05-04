package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId
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
  private def at(offsetSeconds: Long): Instant = baseInstant.plusSeconds(offsetSeconds)

  test("find returns None for an unknown id"):
    freshRepo.flatMap(_.find(HeldEventId("does_not_exist"))).map(r => assertEquals(r, None))

  test("create + find round-trips the held event"):
    val event = HeldEvent(HeldEventId("held_2026_04_30"), baseInstant)
    for
      repo <- freshRepo
      _ <- repo.create(event)
      got <- repo.find(event.id)
    yield assertEquals(got, Some(event))

  test("list orders events by heldAt desc, then by id desc as tie-breaker"):
    val older = HeldEvent(HeldEventId("held_alpha"), at(0))
    val newer = HeldEvent(HeldEventId("held_beta"), at(60))
    val tieA = HeldEvent(HeldEventId("held_zzz"), at(120))
    val tieB = HeldEvent(HeldEventId("held_aaa"), at(120))
    for
      repo <- freshRepo
      _ <- repo.create(older)
      _ <- repo.create(newer)
      _ <- repo.create(tieA)
      _ <- repo.create(tieB)
      list <- repo.list(query = None, limit = 10)
    yield
      assertEquals(list.size, 4, s"expected 4 events, got: $list")
      assertEquals(list.map(_.id.value).take(2).toSet, Set("held_zzz", "held_aaa"))
      assertEquals(list(2).id.value, "held_beta")
      assertEquals(list(3).id.value, "held_alpha")

  test("list applies limit"):
    val a = HeldEvent(HeldEventId("held_001"), at(0))
    val b = HeldEvent(HeldEventId("held_002"), at(60))
    val c = HeldEvent(HeldEventId("held_003"), at(120))
    for
      repo <- freshRepo
      _ <- repo.create(a)
      _ <- repo.create(b)
      _ <- repo.create(c)
      list <- repo.list(query = None, limit = 2)
    yield assertEquals(list.size, 2)

  test("list with negative limit returns no events"):
    val event = HeldEvent(HeldEventId("held_neg"), baseInstant)
    for
      repo <- freshRepo
      _ <- repo.create(event)
      list <- repo.list(query = None, limit = -1)
    yield assertEquals(list, Nil)

  test("list with empty / whitespace query is treated as no filter"):
    val a = HeldEvent(HeldEventId("held_alpha"), at(0))
    val b = HeldEvent(HeldEventId("held_beta"), at(60))
    for
      repo <- freshRepo
      _ <- repo.create(a)
      _ <- repo.create(b)
      empty <- repo.list(query = Some(""), limit = 10)
      blank <- repo.list(query = Some("   "), limit = 10)
    yield
      assertEquals(empty.map(_.id.value).toSet, Set("held_alpha", "held_beta"))
      assertEquals(blank.map(_.id.value).toSet, Set("held_alpha", "held_beta"))

  test("list query filters by case-insensitive substring of id"):
    val a = HeldEvent(HeldEventId("held_2026_04_30"), at(0))
    val b = HeldEvent(HeldEventId("held_2026_05_07"), at(60))
    val c = HeldEvent(HeldEventId("held_2025_12_25"), at(120))
    for
      repo <- freshRepo
      _ <- repo.create(a)
      _ <- repo.create(b)
      _ <- repo.create(c)
      lower <- repo.list(query = Some("2026"), limit = 10)
      upper <- repo.list(query = Some("HELD_2026"), limit = 10)
      none <- repo.list(query = Some("nope"), limit = 10)
    yield
      assertEquals(lower.map(_.id.value).toSet, Set("held_2026_04_30", "held_2026_05_07"))
      assertEquals(upper.map(_.id.value).toSet, Set("held_2026_04_30", "held_2026_05_07"))
      assertEquals(none, Nil)
end HeldEventsRepositoryContract
