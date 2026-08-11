package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*

import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.*

final class PostgresSourceImagesRepositorySpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-11T12:00:00Z")
  private val accountId = AccountId.unsafeFromString("account_ponta")

  private def repository = PostgresSourceImagesRepository[IO](transactor)

  test("reserve converges concurrent requests on one account idempotency hash"):
    val first = reservation("source-concurrent-1", "a" * 64)
    val second = reservation("source-concurrent-2", "a" * 64)

    (repository.reserve(first), repository.reserve(second)).parTupled.map { results =>
      val records = List(results._1, results._2).map {
        case SourceImageReservationResult.Reserved(image) => image
        case SourceImageReservationResult.Existing(image) => image
      }
      assertEquals(records.map(_.id).distinct.size, 1)
      assertEquals(
        List(results._1, results._2).count(isReserved),
        1,
      )
    }

  test("available transition is compare-and-set and persists provider-neutral metadata"):
    val candidate = reservation("source-available", "b" * 64)

    for
      reserved <- repository.reserve(candidate)
      transitioned <- repository.markAvailable(candidate.id, Some("etag-1"), now.plusSeconds(1))
      transitionedAgain <- repository.markAvailable(
        candidate.id,
        Some("etag-2"),
        now.plusSeconds(2),
      )
      stored <- repository.find(candidate.id)
    yield
      assert(isReserved(reserved))
      assert(transitioned)
      assert(!transitionedAgain)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Available))
      assertEquals(stored.flatMap(_.storageEtag), Some("etag-1"))
      assertEquals(stored.flatMap(_.sha256), Some(candidate.sha256))

  test("failed uploads can be reclaimed once and retried forward"):
    val candidate = reservation("source-retry", "c" * 64)

    for
      _ <- repository.reserve(candidate)
      failed <- repository.markUploadFailed(
        candidate.id,
        SourceImageFailureCode.ObjectPutUnavailable,
        now.plusSeconds(1),
      )
      retried <- repository.retryFailed(candidate.id, now.plusSeconds(2))
      retriedAgain <- repository.retryFailed(candidate.id, now.plusSeconds(3))
      stored <- repository.find(candidate.id)
    yield
      assert(failed)
      assert(retried)
      assert(!retriedAgain)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Reserved))
      assertEquals(stored.flatMap(_.failureCode), None)

  test("delete transitions are resumable and never resurrect deleted rows"):
    val candidate = reservation("source-delete", "d" * 64)

    for
      _ <- repository.reserve(candidate)
      _ <- repository.markAvailable(candidate.id, None, now.plusSeconds(1))
      first <- repository.beginDelete(candidate.id, now.plusSeconds(2))
      resumed <- repository.beginDelete(candidate.id, now.plusSeconds(3))
      marked <- repository.markDeleted(candidate.id, now.plusSeconds(4))
      markedAgain <- repository.markDeleted(candidate.id, now.plusSeconds(5))
      afterDelete <- repository.beginDelete(candidate.id, now.plusSeconds(6))
    yield
      assert(isPending(first))
      assert(isPending(resumed))
      assert(marked)
      assert(!markedAgain)
      assertEquals(afterDelete, SourceImageDeleteResult.AlreadyDeleted)

  test("reconciliation candidates are bounded, stale, and deterministically ordered"):
    val older = reservation("source-old", "e" * 64).copy(now = now.minusSeconds(120))
    val recent = reservation("source-recent", "f" * 64).copy(now = now)

    for
      _ <- repository.reserve(recent)
      _ <- repository.reserve(older)
      candidates <- repository.reconciliationCandidates(now.minusSeconds(60), limit = 10)
    yield assertEquals(candidates.map(_.id), List(older.id))

  private def reservation(id: String, idempotencyHash: String): SourceImageReservation =
    val imageId = ImageId.unsafeFromString(id)
    SourceImageReservation(
      id = imageId,
      ownerAccountId = accountId,
      objectKey = SourceImageObjectKey.forImage(imageId, "png").fold(fail(_), identity),
      idempotencyKeyHash = SourceImageIdempotencyHash.fromString(idempotencyHash)
        .fold(fail(_), identity),
      mediaType = "image/png",
      sizeBytes = 128,
      sha256 = Sha256Hex.digest(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
      width = 1920,
      height = 1080,
      now = now,
    )

  private def isReserved(result: SourceImageReservationResult): Boolean = result match
    case SourceImageReservationResult.Reserved(_) => true
    case SourceImageReservationResult.Existing(_) => false

  private def isPending(result: SourceImageDeleteResult): Boolean = result match
    case SourceImageDeleteResult.Pending(_) => true
    case _ => false
