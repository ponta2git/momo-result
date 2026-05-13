package momo.api.adapters

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.ids.AccountId
import momo.api.repositories.{IdempotencyRecord, IdempotencyReservation, IdempotencyResponse}

final class InMemoryIdempotencyRepositorySpec extends CatsEffectSuite:

  private val now = Instant.parse("2026-04-30T12:00:00Z")
  private val later = now.plusSeconds(60 * 60 * 24)
  private val member = AccountId.unsafeFromString("ponta")

  private def record(
      key: String,
      endpoint: String,
      hash: Vector[Byte],
      expiresAt: Instant,
  ): IdempotencyRecord = IdempotencyRecord(
    key = key,
    accountId = member,
    endpoint = endpoint,
    requestHash = hash,
    response = IdempotencyResponse(200, Map("Content-Type" -> "application/json"), Vector.empty),
    createdAt = now,
    expiresAt = expiresAt,
  )

  private val draftEndpoint = "POST /api/match-drafts"
  private val ocrEndpoint = "POST /api/ocr-jobs"
  private val defaultHash = Vector(1.toByte, 2.toByte, 3.toByte)

  private def freshRecord(key: String): IdempotencyRecord =
    record(key, draftEndpoint, defaultHash, later)

  private def pendingRecord(key: String): IdempotencyRecord = freshRecord(key)
    .copy(response = IdempotencyResponse(0, Map.empty, Vector.empty))

  test("lookup returns None when no record exists"):
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      got <- repo.lookup("k1", member, draftEndpoint)
    yield assertEquals(got, None)

  test("record + lookup round-trips a stored entry"):
    val r = freshRecord("k1")
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      _ <- repo.record(r)
      got <- repo.lookup(r.key, r.accountId, r.endpoint)
    yield assertEquals(got, Some(r))

  test("record fails when the same composite key is reused"):
    val r = freshRecord("k2")
    val effect =
      for
        repo <- InMemoryIdempotencyRepository.create[IO]
        _ <- repo.record(r)
        _ <- repo.record(r)
      yield ()
    effect.attempt
      .map(result => assert(result.isLeft, s"expected duplicate insert to fail, got: $result"))

  test("the same key on a different endpoint is treated as a different record"):
    val a = record("kshared", draftEndpoint, defaultHash, later)
    val b = record("kshared", ocrEndpoint, defaultHash, later)
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      _ <- repo.record(a)
      _ <- repo.record(b)
      gotA <- repo.lookup("kshared", member, draftEndpoint)
      gotB <- repo.lookup("kshared", member, ocrEndpoint)
    yield
      assertEquals(gotA, Some(a))
      assertEquals(gotB, Some(b))

  test("cleanup deletes records whose expiresAt has passed and leaves the rest"):
    val expired = record("expired", draftEndpoint, defaultHash, now.minusSeconds(1))
    val live = record("live", draftEndpoint, defaultHash, now.plusSeconds(60))
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      _ <- repo.record(expired)
      _ <- repo.record(live)
      removed <- repo.cleanup(now)
      gotExpired <- repo.lookup(expired.key, member, expired.endpoint)
      gotLive <- repo.lookup(live.key, member, live.endpoint)
    yield
      assertEquals(removed, 1)
      assertEquals(gotExpired, None)
      assertEquals(gotLive, Some(live))

  test("reserve, complete, replay, conflict, and abandon form the atomic lifecycle"):
    val pending = pendingRecord("k-reserve")
    val completed = IdempotencyResponse(200, Map("Content-Type" -> "application/json"), Vector(1))
    for
      repo <- InMemoryIdempotencyRepository.create[IO]
      first <- repo.reserve(pending)
      second <- repo.reserve(pending)
      conflict <- repo.reserve(pending.copy(requestHash = Vector(9.toByte)))
      _ <- repo
        .complete(pending.key, pending.accountId, pending.endpoint, pending.requestHash, completed)
      replay <- repo.reserve(pending)
      abandonedKey = "k-abandon"
      abandoned = pending.copy(key = abandonedKey)
      reserved <- repo.reserve(abandoned)
      _ <- repo
        .abandon(abandoned.key, abandoned.accountId, abandoned.endpoint, abandoned.requestHash)
      reservedAgain <- repo.reserve(abandoned)
    yield
      assertEquals(first, IdempotencyReservation.Reserved)
      assertEquals(second, IdempotencyReservation.InProgress)
      assertEquals(conflict, IdempotencyReservation.Conflict)
      assertEquals(replay, IdempotencyReservation.Replay(completed))
      assertEquals(reserved, IdempotencyReservation.Reserved)
      assertEquals(reservedAgain, IdempotencyReservation.Reserved)
end InMemoryIdempotencyRepositorySpec
