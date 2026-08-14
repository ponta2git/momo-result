package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.*

final class PostgresSourceImagesRepositorySpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-11T12:00:00Z")
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val generousQuota = SourceImageQuota(1000, Long.MaxValue)

  private def repository = PostgresSourceImagesRepository[IO](transactor)

  test("reserve converges concurrent requests on one account idempotency hash"):
    val first = reservation("source-concurrent-1", "a" * 64)
    val second = reservation("source-concurrent-2", "a" * 64)

    (
      repository.reserveWithinQuota(first, generousQuota),
      repository.reserveWithinQuota(second, generousQuota),
    ).parTupled.map { results =>
      val records = List(results._1, results._2).map {
        case SourceImageReservationResult.Reserved(image) => image
        case SourceImageReservationResult.Existing(image) => image
        case SourceImageReservationResult.Rejected(rejection) =>
          fail(s"idempotent retry must not be rejected: $rejection")
      }
      assertEquals(records.map(_.id).distinct.size, 1)
      assertEquals(
        List(results._1, results._2).count(isReserved),
        1,
      )
    }

  test("reserveWithinQuota serializes concurrent reservations per account"):
    val quota = SourceImageQuota(unreferencedCountLimit = 2, unreferencedBytesLimit = 256)
    val candidates = (1 to 8).toList.map(index =>
      reservation(s"source-quota-$index", f"$index%064x")
    )

    for
      results <- candidates.parTraverse(repository.reserveWithinQuota(_, quota))
      usage <- currentUsage
    yield
      assertEquals(results.count(isReserved), 2)
      assertEquals(results.count(isRejected), 6)
      assertEquals(usage, (2L, 256L))

  test("an idempotent retry remains free when the account is already at quota"):
    val quota = SourceImageQuota(unreferencedCountLimit = 1, unreferencedBytesLimit = 128)
    val first = reservation("source-quota-retry", "9" * 64)
    val other = reservation("source-quota-other", "8" * 64)

    for
      reserved <- repository.reserveWithinQuota(first, quota)
      replay <- repository.reserveWithinQuota(
        first.copy(id =
          ImageId.unsafeFromString(
            "source-quota-retry-new-id"
          )
        ),
        quota
      )
      rejected <- repository.reserveWithinQuota(other, quota)
      usage <- currentUsage
    yield
      assert(isReserved(reserved))
      replay match
        case SourceImageReservationResult.Existing(image) => assertEquals(image.id, first.id)
        case other => fail(s"expected existing reservation, got $other")
      assert(isRejected(rejected))
      assertEquals(usage._1, 1L)

  test("reserveWithinQuota reports the atomic byte-limit decision"):
    val candidate = reservation("source-quota-bytes", "7" * 64)

    repository.reserveWithinQuota(
      candidate,
      SourceImageQuota(unreferencedCountLimit = 10, unreferencedBytesLimit = 127),
    ).map {
      case SourceImageReservationResult.Rejected(
            SourceImageQuotaRejection.BytesExceeded(bytesAfter, limit)
          ) =>
        assertEquals(bytesAfter, 128L)
        assertEquals(limit, 127L)
      case other => fail(s"expected byte quota rejection, got $other")
    }

  test("referenced images do not consume the unreferenced reservation quota"):
    val referenced = reservation("source-quota-referenced", "6" * 64)
    val next = reservation("source-quota-after-reference", "5" * 64)
    val quota = SourceImageQuota(unreferencedCountLimit = 1, unreferencedBytesLimit = 128)
    val insertReference = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, source_image_id, queue_schema_version,
        requested_screen_type, status, attempt_count, created_at, updated_at
      ) VALUES (
        'job-source-quota-reference', 'draft-source-quota-reference',
        ${referenced.id}, ${referenced.id}, 2, 'total_assets', 'queued', 0, $now, $now
      )
    """.update.run.transact(transactor)

    for
      first <- repository.reserveWithinQuota(referenced, quota)
      _ <- insertReference
      second <- repository.reserveWithinQuota(next, quota)
    yield
      assert(isReserved(first))
      assert(isReserved(second))

  test("available transition is compare-and-set and persists provider-neutral metadata"):
    val candidate = reservation("source-available", "b" * 64)

    for
      reserved <- repository.reserveWithinQuota(candidate, generousQuota)
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
      _ <- repository.reserveWithinQuota(candidate, generousQuota)
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
      _ <- repository.reserveWithinQuota(candidate, generousQuota)
      _ <- repository.markAvailable(candidate.id, None, now.plusSeconds(1))
      first <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(2))
      resumed <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(3))
      marked <- repository.markDeleted(candidate.id, now.plusSeconds(4))
      markedAgain <- repository.markDeleted(candidate.id, now.plusSeconds(5))
      afterDelete <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(6))
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
      _ <- repository.reserveWithinQuota(recent, generousQuota)
      _ <- repository.reserveWithinQuota(older, generousQuota)
      candidates <- repository.reconciliationCandidates(now.minusSeconds(60), limit = 10)
    yield assertEquals(candidates.map(_.id), List(older.id))

  test("orphan deletion rechecks references atomically before changing state"):
    val candidate = reservation("source-referenced", "1" * 64)
    val insertReference = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, source_image_id, queue_schema_version,
        requested_screen_type, status, attempt_count, created_at, updated_at
      ) VALUES (
        'job-source-reference', 'draft-source-reference', ${candidate.id}, ${candidate.id}, 2,
        'total_assets', 'queued', 0, $now, $now
      )
    """.update.run.transact(transactor)

    for
      _ <- repository.reserveWithinQuota(candidate, generousQuota)
      _ <- repository.markAvailable(candidate.id, None, now)
      _ <- insertReference
      candidates <- repository.orphanCandidates(now.plusSeconds(1), limit = 10)
      guarded <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(2))
      _ <- sql"DELETE FROM ocr_jobs WHERE id = 'job-source-reference'".update.run
        .transact(transactor)
      pending <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(3))
    yield
      assertEquals(candidates, Nil)
      assertEquals(guarded, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))
      assert(isPending(pending))

  test("reference guard covers legacy and v2 OCR image columns"):
    val legacy = reservation("source-reference-legacy", "3" * 64)
    val v2 = reservation("source-reference-v2", "4" * 64)
    val insertReferences = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, image_path, source_image_id, queue_schema_version,
        requested_screen_type, status, attempt_count, created_at, updated_at
      ) VALUES
        ('job-source-reference-legacy', 'draft-source-reference-legacy', ${legacy.id},
         '/tmp/source-reference-legacy.png',
         NULL, 1, 'total_assets', 'queued', 0, $now, $now),
        ('job-source-reference-v2', 'draft-source-reference-v2', 'legacy-v2-placeholder',
         NULL, ${v2.id}, 2, 'total_assets', 'queued', 0, $now, $now)
    """.update.run.transact(transactor)

    for
      _ <- List(legacy, v2).traverse_(candidate =>
        repository.reserveWithinQuota(candidate, generousQuota) *>
          repository.markAvailable(candidate.id, None, now).void
      )
      _ <- insertReferences
      legacyDeletion <- repository.beginDeleteUnreferenced(legacy.id, now.plusSeconds(1))
      v2Deletion <- repository.beginDeleteUnreferenced(v2.id, now.plusSeconds(1))
    yield
      assertEquals(legacyDeletion, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))
      assertEquals(v2Deletion, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))

  test("draft reference guard is released only by the source-images-deleted marker"):
    val candidate = reservation("source-reference-draft", "a" * 64)
    val draftId = "draft-source-reference-marker"
    val insertDraft = sql"""
      INSERT INTO match_drafts (
        id, created_by_account_id, created_by_member_id, status,
        total_assets_image_id, created_at, updated_at
      ) VALUES (
        $draftId, 'account_ponta', 'member_ponta', 'draft_ready', ${candidate.id}, $now, $now
      )
    """.update.run.transact(transactor)

    for
      _ <- repository.reserveWithinQuota(candidate, generousQuota)
      _ <- repository.markAvailable(candidate.id, None, now)
      _ <- insertDraft
      guarded <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(1))
      _ <- sql"""
        UPDATE match_drafts SET source_images_deleted_at = ${now.plusSeconds(2)} WHERE id = $draftId
      """.update.run.transact(transactor)
      pending <- repository.beginDeleteUnreferenced(candidate.id, now.plusSeconds(3))
    yield
      assertEquals(guarded, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))
      assert(isPending(pending))

  test("terminal job and draft references do not retain AVAILABLE objects forever"):
    val jobImage = reservation("source-reference-terminal-job", "b" * 64)
    val draftImage = reservation("source-reference-terminal-draft", "c" * 64)
    val insertTerminalJob = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, source_image_id, queue_schema_version,
        requested_screen_type, detected_screen_type, status, attempt_count,
        started_at, finished_at, duration_ms, created_at, updated_at
      ) VALUES (
        'job-source-reference-terminal', 'draft-source-reference-terminal', ${jobImage.id},
        ${jobImage.id}, 2, 'total_assets', 'total_assets', 'succeeded', 1,
        $now, $now, 1, $now, $now
      )
    """.update.run.transact(transactor)
    val insertTerminalDraft = sql"""
      INSERT INTO match_drafts (
        id, created_by_account_id, created_by_member_id, status,
        total_assets_image_id, created_at, updated_at
      ) VALUES (
        'draft-source-reference-terminal', 'account_ponta', 'member_ponta', 'cancelled',
        ${draftImage.id}, $now, $now
      )
    """.update.run.transact(transactor)

    for
      _ <- List(jobImage, draftImage).traverse_(candidate =>
        repository.reserveWithinQuota(candidate, generousQuota) *>
          repository.markAvailable(candidate.id, None, now).void
      )
      _ <- insertTerminalJob
      _ <- insertTerminalDraft
      jobPending <- repository.beginDeleteUnreferenced(jobImage.id, now.plusSeconds(1))
      draftPending <- repository.beginDeleteUnreferenced(draftImage.id, now.plusSeconds(1))
    yield
      assert(isPending(jobPending))
      assert(isPending(draftPending))

  test("old unreferenced FAILED reservations require an exact purge claim"):
    val candidate = reservation("source-failed-purge", "2" * 64)

    for
      _ <- repository.reserveWithinQuota(candidate, generousQuota)
      _ <- repository.markUploadFailed(
        candidate.id,
        SourceImageFailureCode.ObjectMissing,
        now.minusSeconds(120),
      )
      claimed <- repository.claimFailedPurge(
        candidate.id,
        now.minusSeconds(60),
        now.minusSeconds(30),
        now,
      )
      retryWhileClaimed <- repository.retryFailed(candidate.id, now.plusSeconds(1))
      wrongClaim <- repository.purgeClaimedFailed(candidate.id, now.minusSeconds(1))
      purged <- repository.purgeClaimedFailed(candidate.id, now)
      stored <- repository.find(candidate.id)
    yield
      assertEquals(claimed.map(_.id), Some(candidate.id))
      assert(!retryWhileClaimed)
      assert(!wrongClaim)
      assert(purged)
      assertEquals(stored, None)

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

  private def currentUsage: IO[(Long, Long)] = sql"""
      SELECT COUNT(*)::bigint, COALESCE(SUM(byte_length), 0)::bigint
      FROM source_images
      WHERE owner_account_id = $accountId
        AND status <> 'DELETED'
    """.query[(Long, Long)].unique.transact(transactor)

  private def isReserved(result: SourceImageReservationResult): Boolean = result match
    case SourceImageReservationResult.Reserved(_) => true
    case SourceImageReservationResult.Existing(_) | SourceImageReservationResult.Rejected(_) =>
      false

  private def isRejected(result: SourceImageReservationResult): Boolean = result match
    case SourceImageReservationResult.Rejected(_) => true
    case SourceImageReservationResult.Reserved(_) | SourceImageReservationResult.Existing(_) =>
      false

  private def isPending(result: SourceImageDeleteResult): Boolean = result match
    case SourceImageDeleteResult.Pending(_) => true
    case _ => false
