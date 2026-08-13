package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, PageRequest}
import momo.api.errors.{AppError, AppException}
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
    freshRepo.flatMap(_.find(HeldEventId.unsafeFromString("does_not_exist")))
      .map(r => assertEquals(r, None))

  test("create + find round-trips the held event"):
    val event = HeldEvent(HeldEventId.unsafeFromString("held_2026_04_30"), baseInstant)
    for
      repo <- freshRepo
      _ <- repo.create(event)
      got <- repo.find(event.id)
    yield assertEquals(got, Some(event))

  test("create rejects duplicate held event ids as a conflict"):
    val event = HeldEvent(HeldEventId.unsafeFromString("held_duplicate"), baseInstant)
    for
      repo <- freshRepo
      _ <- repo.create(event)
      duplicate <- repo.create(event).attempt
    yield duplicate match
      case Left(error: AppException) =>
        assertEquals(error.error, AppError.Conflict("held event already exists: held_duplicate"))
      case other => fail(s"expected AppException(Conflict), got $other")

  test("listPage applies ordering and offset pagination and returns total count"):
    val older = HeldEvent(HeldEventId.unsafeFromString("held_alpha"), at(0))
    val newer = HeldEvent(HeldEventId.unsafeFromString("held_beta"), at(60))
    val tieA = HeldEvent(HeldEventId.unsafeFromString("held_zzz"), at(120))
    val tieB = HeldEvent(HeldEventId.unsafeFromString("held_aaa"), at(120))
    for
      repo <- freshRepo
      _ <- repo.create(older)
      _ <- repo.create(newer)
      _ <- repo.create(tieA)
      _ <- repo.create(tieB)
      first <- repo.listPage(query = None, PageRequest(page = 1, pageSize = 3))
      second <- repo.listPage(query = None, PageRequest(page = 2, pageSize = 3))
      filtered <- repo.listPage(query = Some("HELD_BETA"), PageRequest(page = 1, pageSize = 3))
    yield
      assertEquals(first.items.map(_.id.value), List("held_zzz", "held_aaa", "held_beta"))
      assertEquals(second.items.map(_.id.value), List("held_alpha"))
      assertEquals(first.totalItems, 4)
      assertEquals(first.totalPages, 2)
      assertEquals(first.hasPreviousPage, false)
      assertEquals(first.hasNextPage, true)
      assertEquals(second.hasPreviousPage, true)
      assertEquals(second.hasNextPage, false)
      assertEquals(filtered.items.map(_.id.value), List("held_beta"))
      assertEquals(filtered.totalItems, 1)

  test("listIds applies ordered, case-insensitive filtering and treats blank as no filter"):
    val a = HeldEvent(HeldEventId.unsafeFromString("held_ids_2026_a"), at(0))
    val b = HeldEvent(HeldEventId.unsafeFromString("held_ids_2026_b"), at(60))
    val c = HeldEvent(HeldEventId.unsafeFromString("held_ids_2025_c"), at(120))
    for
      repo <- freshRepo
      _ <- repo.create(a)
      _ <- repo.create(b)
      _ <- repo.create(c)
      ids <- repo.listIds(query = Some("2026"))
      upper <- repo.listIds(query = Some("HELD_IDS_2026"))
      blank <- repo.listIds(query = Some("   "))
      none <- repo.listIds(query = Some("nope"))
    yield
      val expected = List("held_ids_2026_b", "held_ids_2026_a")
      assertEquals(ids.map(_.value), expected)
      assertEquals(upper.map(_.value), expected)
      assertEquals(
        blank.map(_.value),
        List("held_ids_2025_c", "held_ids_2026_b", "held_ids_2026_a")
      )
      assertEquals(none, Nil)
end HeldEventsRepositoryContract
