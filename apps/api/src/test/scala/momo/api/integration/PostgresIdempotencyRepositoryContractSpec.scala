package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.ids.MemberId
import momo.api.repositories.postgres.PostgresIdempotencyRepository
import momo.api.repositories.{IdempotencyRecord, IdempotencyRepository, IdempotencyResponse}

/**
 * Postgres-backed contract verification for [[IdempotencyRepository]]. Mirrors
 * `InMemoryIdempotencyRepositorySpec` so behavior parity between the two adapters is enforced.
 *
 * Skipped automatically when local Postgres on :5433 is unavailable.
 */
final class PostgresIdempotencyRepositoryContractSpec extends IntegrationSuite:

  private val now = Instant.parse("2026-04-30T12:00:00Z")
  private val later = now.plusSeconds(60 * 60 * 24)
  private val member = MemberId("member_ponta")

  private def freshRepo: IdempotencyRepository[IO] =
    new PostgresIdempotencyRepository[IO](transactor)

  private def buildRecord(
      key: String,
      endpoint: String,
      hash: Vector[Byte],
      expiresAt: Instant,
      body: Vector[Byte],
  ): IdempotencyRecord = IdempotencyRecord(
    key = key,
    memberId = member,
    endpoint = endpoint,
    requestHash = hash,
    response = IdempotencyResponse(
      status = 201,
      headers = Map("Content-Type" -> "application/json"),
      body = body,
    ),
    createdAt = now,
    expiresAt = expiresAt,
  )

  private val draftEndpoint = "POST /api/match-drafts"
  private val ocrEndpoint = "POST /api/ocr-jobs"
  private val defaultHash = Vector(1.toByte, 2.toByte, 3.toByte)

  test("lookup returns None when no record exists"):
    val repo = freshRepo
    repo.lookup("missing", member, draftEndpoint).map(got => assertEquals(got, None))

  test("record + lookup round-trips a stored entry, preserving bytes and headers"):
    val repo = freshRepo
    val r = buildRecord("k1", draftEndpoint, defaultHash, later, Vector(9.toByte, 8.toByte))
    for
      _ <- repo.record(r)
      got <- repo.lookup(r.key, r.memberId, r.endpoint)
    yield assertEquals(got, Some(r))

  test("record with empty body round-trips as empty body"):
    val repo = freshRepo
    val r = buildRecord("k-empty", draftEndpoint, defaultHash, later, Vector.empty)
    for
      _ <- repo.record(r)
      got <- repo.lookup(r.key, r.memberId, r.endpoint)
    yield assertEquals(got.map(_.response.body), Some(Vector.empty[Byte]))

  test("record fails when the same composite key is reused"):
    val repo = freshRepo
    val r = buildRecord("k-dup", draftEndpoint, defaultHash, later, Vector.empty)
    val effect = repo.record(r) *> repo.record(r)
    effect.attempt.map(result => assert(result.isLeft, s"expected conflict, got $result"))

  test("the same key on a different endpoint is treated as a different record"):
    val repo = freshRepo
    val a = buildRecord("kshared", draftEndpoint, defaultHash, later, Vector.empty)
    val b = buildRecord("kshared", ocrEndpoint, defaultHash, later, Vector.empty)
    for
      _ <- repo.record(a)
      _ <- repo.record(b)
      gotA <- repo.lookup("kshared", member, draftEndpoint)
      gotB <- repo.lookup("kshared", member, ocrEndpoint)
    yield
      assertEquals(gotA, Some(a))
      assertEquals(gotB, Some(b))

  test("cleanup deletes records whose expires_at has passed and leaves the rest"):
    val repo = freshRepo
    val expired =
      buildRecord("expired", draftEndpoint, defaultHash, now.minusSeconds(1), Vector.empty)
    val live = buildRecord("live", draftEndpoint, defaultHash, now.plusSeconds(60), Vector.empty)
    for
      _ <- repo.record(expired)
      _ <- repo.record(live)
      removed <- repo.cleanup(now)
      gotExpired <- repo.lookup(expired.key, member, expired.endpoint)
      gotLive <- repo.lookup(live.key, member, live.endpoint)
    yield
      assertEquals(removed, 1)
      assertEquals(gotExpired, None)
      assertEquals(gotLive, Some(live))
end PostgresIdempotencyRepositoryContractSpec
