package momo.api.repositories.contract

import java.time.Instant

import cats.effect.IO
import munit.CatsEffectSuite

import momo.api.domain.ids.AccountId
import momo.api.repositories.{
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyReservation,
  IdempotencyResponse
}

/**
 * Behaviour contract for [[IdempotencyRepository]] implementations.
 *
 * Idempotency is a cross-cutting safety boundary, so in-memory test adapters and Postgres must
 * agree on the same observable lifecycle. Implementation-specific storage details belong in
 * separate focused specs; this contract fixes the shared API semantics.
 */
trait IdempotencyRepositoryContract:
  this: CatsEffectSuite =>

  protected def freshRepo: IO[IdempotencyRepository[IO]]

  private val now = Instant.parse("2026-04-30T12:00:00Z")
  private val later = now.plusSeconds(60 * 60 * 24)
  private val account = AccountId.unsafeFromString("account_ponta")
  private val draftEndpoint = "POST /api/match-drafts"
  private val ocrEndpoint = "POST /api/ocr-jobs"
  private val defaultHash = Vector(1.toByte, 2.toByte, 3.toByte)
  private val defaultResponse = IdempotencyResponse(
    status = 201,
    headers = Map("Content-Type" -> "application/json"),
    body = Vector(9.toByte, 8.toByte),
  )
  private val pendingResponse = IdempotencyResponse(0, Map.empty, Vector.empty)

  private def record(
      key: String,
      endpoint: String,
      hash: Vector[Byte],
      expiresAt: Instant,
      response: IdempotencyResponse,
  ): IdempotencyRecord = IdempotencyRecord(
    key = key,
    accountId = account,
    endpoint = endpoint,
    requestHash = hash,
    response = response,
    createdAt = now,
    expiresAt = expiresAt,
  )

  private def completedRecord(key: String): IdempotencyRecord =
    record(key, draftEndpoint, defaultHash, later, defaultResponse)

  private def pendingRecord(key: String): IdempotencyRecord = completedRecord(key)
    .copy(response = pendingResponse)

  private def store(
      repo: IdempotencyRepository[IO],
      entry: IdempotencyRecord,
  ): IO[Unit] = repo.reserveWithinAccountLimit(
    entry.copy(response = pendingResponse),
    now,
    activeKeyLimitPerAccount = 10,
  ).flatMap { reservation =>
    assertEquals(reservation, IdempotencyReservation.Reserved)
    repo.complete(entry.key, entry.accountId, entry.endpoint, entry.requestHash, entry.response)
  }

  test("lookup returns None when no record exists"):
    freshRepo.flatMap(_.lookup("missing", account, draftEndpoint))
      .map(got => assertEquals(got, None))

  test("reserve + complete + lookup round-trips a stored entry, preserving headers and bytes"):
    val entry = completedRecord("k-roundtrip")
    for
      repo <- freshRepo
      _ <- store(repo, entry)
      got <- repo.lookup(entry.key, entry.accountId, entry.endpoint)
    yield assertEquals(got, Some(entry))

  test("completed response with an empty body round-trips as an empty body"):
    val entry = record(
      "k-empty-body",
      draftEndpoint,
      defaultHash,
      later,
      IdempotencyResponse(204, Map("X-Test" -> "empty"), Vector.empty),
    )
    for
      repo <- freshRepo
      _ <- store(repo, entry)
      got <- repo.lookup(entry.key, entry.accountId, entry.endpoint)
    yield assertEquals(got.map(_.response), Some(entry.response))

  test("the same key on a different endpoint is treated as a different record"):
    val first = record("k-shared", draftEndpoint, defaultHash, later, defaultResponse)
    val second = record("k-shared", ocrEndpoint, defaultHash, later, defaultResponse)
    for
      repo <- freshRepo
      _ <- store(repo, first)
      _ <- store(repo, second)
      gotFirst <- repo.lookup(first.key, account, first.endpoint)
      gotSecond <- repo.lookup(second.key, account, second.endpoint)
    yield
      assertEquals(gotFirst, Some(first))
      assertEquals(gotSecond, Some(second))

  test("cleanup deletes records whose expiresAt is at or before now and leaves future records"):
    val expired =
      record("expired", draftEndpoint, defaultHash, now.minusSeconds(1), defaultResponse)
    val boundary = record("boundary", draftEndpoint, defaultHash, now, defaultResponse)
    val live = record("live", draftEndpoint, defaultHash, now.plusSeconds(60), defaultResponse)
    for
      repo <- freshRepo
      _ <- store(repo, expired)
      _ <- store(repo, boundary)
      _ <- store(repo, live)
      removed <- repo.cleanup(now)
      gotExpired <- repo.lookup(expired.key, account, expired.endpoint)
      gotBoundary <- repo.lookup(boundary.key, account, boundary.endpoint)
      gotLive <- repo.lookup(live.key, account, live.endpoint)
    yield
      assertEquals(removed, 2)
      assertEquals(gotExpired, None)
      assertEquals(gotBoundary, None)
      assertEquals(gotLive, Some(live))

  test("abandon removes a pending reservation"):
    val pending = pendingRecord("k-reserve-lifecycle")
    for
      repo <- freshRepo
      reserved <- repo.reserveWithinAccountLimit(pending, now, activeKeyLimitPerAccount = 10)
      _ <- repo
        .abandon(pending.key, pending.accountId, pending.endpoint, pending.requestHash)
      found <- repo.lookup(pending.key, pending.accountId, pending.endpoint)
      reservedAgain <- repo
        .reserveWithinAccountLimit(pending, now, activeKeyLimitPerAccount = 10)
    yield
      assertEquals(reserved, IdempotencyReservation.Reserved)
      assertEquals(found, None)
      assertEquals(reservedAgain, IdempotencyReservation.Reserved)

  test("reserveWithinAccountLimit blocks fresh active keys but preserves existing key semantics"):
    val pending = pendingRecord("k-account-limit-a")
    val blocked = pendingRecord("k-account-limit-b")
    val completed = IdempotencyResponse(200, Map("Content-Type" -> "application/json"), Vector(1))
    for
      repo <- freshRepo
      first <- repo.reserveWithinAccountLimit(pending, now, activeKeyLimitPerAccount = 1)
      inProgress <- repo.reserveWithinAccountLimit(pending, now, activeKeyLimitPerAccount = 1)
      conflict <- repo.reserveWithinAccountLimit(
        pending.copy(requestHash = Vector(9.toByte)),
        now,
        activeKeyLimitPerAccount = 1,
      )
      blockedResult <- repo.reserveWithinAccountLimit(blocked, now, activeKeyLimitPerAccount = 1)
      blockedLookup <- repo.lookup(blocked.key, blocked.accountId, blocked.endpoint)
      _ <- repo
        .complete(pending.key, pending.accountId, pending.endpoint, pending.requestHash, completed)
      replay <- repo.reserveWithinAccountLimit(pending, now, activeKeyLimitPerAccount = 1)
    yield
      assertEquals(first, IdempotencyReservation.Reserved)
      assertEquals(inProgress, IdempotencyReservation.InProgress)
      assertEquals(conflict, IdempotencyReservation.Conflict)
      assertEquals(blockedResult, IdempotencyReservation.AccountLimitExceeded)
      assertEquals(blockedLookup, None)
      assertEquals(replay, IdempotencyReservation.Replay(completed))

  test("reserveWithinAccountLimit does not count expired records"):
    val expired = record("k-expired-limit", draftEndpoint, defaultHash, now, defaultResponse)
    val fresh = pendingRecord("k-fresh-after-expired")
    for
      repo <- freshRepo
      _ <- store(repo, expired)
      reserved <- repo.reserveWithinAccountLimit(fresh, now, activeKeyLimitPerAccount = 1)
    yield assertEquals(reserved, IdempotencyReservation.Reserved)
end IdempotencyRepositoryContract
