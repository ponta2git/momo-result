package momo.api.integration

import java.sql.Connection
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.{
  PostgresMatchDraftCancellationRepository,
  PostgresOcrSubmissionsRepository,
  PostgresSourceImagesRepository
}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.*

final class PostgresOcrSubmissionsRepositorySpec extends IntegrationSuite:
  private val owner = AccountId.unsafeFromString("account_ponta")
  private val otherOwner = AccountId.unsafeFromString("account_eu")
  private val draft = MatchDraftId.unsafeFromString("submission-contract-draft")
  private val image = ImageId.unsafeFromString("submission-contract-image")
  private val key = SourceImageIdempotencyHash.fromRawKey("submission-contract-upload")
  private val digest = "a" * 64
  private def repository = PostgresOcrSubmissionsRepository[IO](transactor)
  private def images = PostgresSourceImagesRepository[IO](transactor)

  private def submission(): OcrSubmission =
    val id = UUID.randomUUID().toString
    val now = Instant.now()
    OcrSubmission(
      id,
      owner,
      draft,
      OcrJobHints.empty,
      "open",
      now.plusSeconds(600),
      now,
      None,
      List(OcrSubmissionMember(ScreenType.TotalAssets, key.value, digest, 128))
    )

  private def seedDraft: IO[Unit] = sql"""INSERT INTO match_drafts
    (id, created_by_account_id, status) VALUES (${draft.value}, ${owner.value}, 'draft_ready')"""
    .update.run.transact(transactor).void

  private def seedImage: IO[Unit] = seedImage(image, key)

  private def seedImage(id: ImageId, hash: SourceImageIdempotencyHash): IO[Unit] =
    val now = Instant.now()
    val reservation = SourceImageReservation(
      id,
      owner,
      SourceImageObjectKey.forImage(id, "png").fold(fail(_), identity),
      hash,
      "image/png",
      128,
      Sha256Hex.fromString(digest).fold(fail(_), identity),
      1,
      1,
      now
    )
    images.reserveWithinQuota(reservation, SourceImageQuota(100, 1024 * 1024)) *>
      images.markAvailable(id, None, now).void

  test("only accepted admission moves an empty draft into OCR running") {
    val refusedDraft = MatchDraftId.unsafeFromString("submission-refused-draft")
    for
      _ <- seedDraft
      first <- repository.put(submission())
      acceptedStatus <- sql"SELECT status FROM match_drafts WHERE id = ${draft.value}"
        .query[String].unique.transact(transactor)
      _ <- List.fill(3)(submission()).traverse_(repository.put)
      _ <- sql"""INSERT INTO match_drafts (id, created_by_account_id, status)
        VALUES (${refusedDraft.value}, ${owner.value}, 'draft_ready')""".update.run.transact(
        transactor
      )
      refused <- repository.put(submission().copy(matchDraftId = refusedDraft))
      refusedStatus <- sql"SELECT status FROM match_drafts WHERE id = ${refusedDraft.value}"
        .query[String].unique.transact(transactor)
    yield
      assert(first.isRight)
      assertEquals(acceptedStatus, "ocr_running")
      assert(refused.isLeft)
      assertEquals(refusedStatus, "draft_ready")
  }

  test("another account cannot attach an OCR submission to the source draft") {
    for
      _ <- seedDraft
      proposed = submission().copy(ownerAccountId = otherOwner)
      result <- repository.put(proposed)
      saved <- repository.find(proposed.id, otherOwner)
      status <- sql"SELECT status FROM match_drafts WHERE id = ${draft.value}"
        .query[String].unique.transact(transactor)
    yield
      assertEquals(result.left.map(_.code), Left("FORBIDDEN"))
      assertEquals(saved, None)
      assertEquals(status, "draft_ready")
  }

  List("draft_ready", "needs_review").foreach { previousStatus =>
    test(s"a later submission preserves $previousStatus when the draft already has result slots") {
      for
        _ <- seedDraft
        _ <- seedImage
        _ <- sql"""UPDATE match_drafts SET status = $previousStatus,
          total_assets_image_id = ${image.value} WHERE id = ${draft.value}"""
          .update.run.transact(transactor)
        result <- repository.put(submission())
        saved <-
          sql"SELECT status, total_assets_image_id FROM match_drafts WHERE id = ${draft.value}"
            .query[(String, String)].unique.transact(transactor)
      yield
        assert(result.isRight)
        assertEquals(saved, (previousStatus, image.value))
    }
  }

  test("simultaneous admission enforces the account cap and domain replay consumes no new slot") {
    for
      _ <- seedDraft
      proposals = List.fill(5)(submission())
      results <- proposals.parTraverse(repository.put)
      accepted = results.flatMap(_.toOption)
      _ = assertEquals(accepted.size, 4)
      _ = assertEquals(results.count(_.isLeft), 1)
      replay <-
        repository.put(accepted.head.copy(admissionDeadline = Instant.now().plusSeconds(999)))
      mismatch <- repository.put(accepted.head.copy(members =
        List(accepted.head.members.head.copy(imageSha256 = "b" * 64))
      ))
      foreign <- repository.find(accepted.head.id, otherOwner)
      count <-
        sql"SELECT count(*) FROM ocr_submissions WHERE status = 'open'".query[Long].unique.transact(
          transactor
        )
    yield
      assertEquals(replay.map(_.admissionDeadline), Right(accepted.head.admissionDeadline))
      assert(mismatch.isLeft)
      assertEquals(foreign, None)
      assertEquals(count, 4L)
  }

  test("initial admission and replay return the persisted timestamp precision") {
    val now = Instant.now().truncatedTo(ChronoUnit.SECONDS).plusNanos(638316517)
    val proposed = submission().copy(createdAt = now, admissionDeadline = now.plusSeconds(600))
    for
      _ <- seedDraft
      admitted <- repository.put(proposed)
      saved <- repository.find(proposed.id, owner)
      replay <- repository.put(proposed)
    yield
      assert(admitted.isRight)
      assertEquals(admitted.toOption, saved)
      assertEquals(replay, admitted)
      assertNotEquals(saved.map(_.createdAt), Some(proposed.createdAt))
      assertNotEquals(saved.map(_.admissionDeadline), Some(proposed.admissionDeadline))
  }

  test(
    "only a matching immutable upload rejection closes admission, then the image becomes reclaimable"
  ) {
    val proposed = submission()
    for
      _ <- seedDraft
      _ <- repository.put(proposed)
      _ <- seedImage
      protectedImage <- images.beginDeleteUnreferenced(image, Instant.now())
      _ <- repository.failAdmission(otherOwner, key.value, digest, 128)
      _ <- repository.failAdmission(owner, key.value, "b" * 64, 128)
      pending <- repository.find(proposed.id, owner)
      _ <- repository.failAdmission(owner, key.value, digest, 128)
      failed <- repository.find(proposed.id, owner)
      deletable <- images.beginDeleteUnreferenced(image, Instant.now())
    yield
      assertEquals(protectedImage, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))
      assertEquals(pending.map(_.members.head.status), Some("pending"))
      assertEquals(failed.map(_.members.head.failureCode), Some(Some("admission_failed")))
      deletable match
        case SourceImageDeleteResult.Pending(_) => ()
        case other => fail(s"expected reclaimable image, got $other")
  }

  List(false, true).foreach { stale =>
    test(s"admission refuses a FAILED image with a purge claim, including stale=$stale") {
      val claimedAt = Instant.now().minusSeconds(if stale then 300 else 0)
      for
        _ <- seedDraft
        _ <- seedFailedImage
        claimed <-
          images.claimFailedPurge(image, Instant.now(), claimedAt.minusSeconds(1), claimedAt)
        admitted <- repository.put(submission())
        count <- sql"SELECT count(*) FROM ocr_submissions".query[Long].unique.transact(transactor)
        status <- sql"SELECT status FROM match_drafts WHERE id = ${draft.value}"
          .query[String].unique.transact(transactor)
      yield
        assertEquals(claimed.map(_.id), Some(image))
        assertEquals(admitted.left.map(_.code), Left("CONFLICT"))
        assertEquals(count, 0L)
        assertEquals(status, "draft_ready")
    }
  }

  test("a FAILED purge waiting behind admission sees the committed pending reference") {
    val proposed = submission()
    for
      _ <- seedDraft
      _ <- seedFailedImage
      // The FK lock pauses the real admission after it has locked its source image, before commit.
      result <-
        withRowLock("SELECT id FROM momo_login_accounts WHERE id = 'account_ponta' FOR UPDATE") {
          (connection, blocker) =>
            repository.put(proposed).background.use { admission =>
              for
                _ <- awaitBackendBlockedBy(blocker)
                admissionPid <- sql"""SELECT pid FROM pg_stat_activity
                WHERE $blocker = ANY(pg_blocking_pids(pid))""".query[Int].unique.transact(
                  transactor
                )
                result <-
                  images.claimFailedPurge(image, Instant.now(), Instant.now(), Instant.now())
                    .background.use { purge =>
                      (for
                        _ <- awaitBlockedBy(connection, admissionPid)
                        _ <- IO.blocking(connection.commit())
                        accepted <- admission.flatMap(_.embedNever)
                        claimed <- purge.flatMap(_.embedNever)
                      yield (accepted, claimed)).guarantee(IO.blocking(connection.rollback()))
                    }
              yield result
            }
        }
      saved <- repository.find(proposed.id, owner)
      retry <- images.retryFailed(image, Instant.now())
    yield
      assert(result._1.isRight)
      assertEquals(result._2, None)
      assertEquals(saved.map(_.members.head.status), Some("pending"))
      assert(retry, "accepted admission must retain the ability to retry its failed upload")
  }

  test("admission locks existing images in ID order even when members arrive in reverse order") {
    val laterImage = ImageId.unsafeFromString("submission-contract-image-z")
    val laterKey = SourceImageIdempotencyHash.fromRawKey("submission-later-upload")
    val proposed = submission().copy(members =
      List(
        OcrSubmissionMember(ScreenType.Revenue, laterKey.value, digest, 128),
        OcrSubmissionMember(ScreenType.TotalAssets, key.value, digest, 128),
        OcrSubmissionMember(ScreenType.IncidentLog, "c" * 64, digest, 128),
      )
    )
    for
      _ <- seedDraft
      _ <- seedImage
      _ <- seedImage(laterImage, laterKey)
      accepted <-
        withRowLock(s"SELECT id FROM source_images WHERE id = '${image.value}' FOR UPDATE") {
          (connection, blocker) =>
            repository.put(proposed).background.use { admission =>
              (for
                _ <- awaitBackendBlockedBy(blocker)
                // Cleanup takes the same ID order. Keeping the later image unlocked while waiting
                // for the first prevents a cycle with that cleanup's next image lock.
                probe <- sql"""SELECT id FROM source_images
                WHERE id = ${laterImage.value} FOR UPDATE NOWAIT"""
                  .query[String].unique.transact(transactor)
                _ = assertEquals(probe, laterImage.value)
                _ <- IO.blocking(connection.commit())
                result <- admission.flatMap(_.embedNever)
              yield result).guarantee(IO.blocking(connection.rollback()))
            }
        }
    yield
      assert(accepted.isRight)
      assertEquals(accepted.toOption.map(_.members.size), Some(3))
  }

  test("GET waits for a terminal writer and returns one consistent header and member state") {
    val proposed = submission()
    for
      _ <- seedDraft
      _ <- repository.put(proposed)
      locked <- Deferred[IO, Either[Throwable, Int]]
      release <- Deferred[IO, Unit]
      result <-
        Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
          val writer =
            (IO.blocking {
              connection.setAutoCommit(false)
              val statement = connection.createStatement()
              try
                statement.executeQuery(
                  s"SELECT id FROM ocr_submissions WHERE id = '${proposed.id}' FOR UPDATE"
                ).close()
                statement.executeUpdate(
                  s"UPDATE ocr_submission_members SET status = 'failed', failure_code = 'admission_failed' WHERE submission_id = '${proposed.id}'"
                )
                statement.executeUpdate(
                  s"UPDATE ocr_submissions SET status = 'settled', finished_at = GREATEST(created_at, clock_timestamp()) WHERE id = '${proposed.id}'"
                )
                val rows = statement.executeQuery("SELECT pg_backend_pid()")
                try
                  assert(rows.next())
                  rows.getInt(1)
                finally rows.close()
              finally statement.close()
            }.flatMap(pid => locked.complete(Right(pid))) *> release.get *>
              IO.blocking(connection.commit()))
              .onError { case error => locked.complete(Left(error)).void }
              .guarantee(IO.blocking(connection.rollback()))
          writer.background.use { completed =>
            for
              pid <- locked.get.rethrow
              response <- repository.find(proposed.id, owner).background.use { reading =>
                (awaitBackendBlockedBy(pid) *> release.complete(()) *>
                  reading.flatMap(_.embedNever))
                  .guarantee(release.complete(()).void)
              }
              _ <- completed.flatMap(_.embedNever)
            yield response
          }
        }
    yield
      assertEquals(result.map(_.status), Some("settled"))
      assertEquals(result.map(_.members.head.status), Some("failed"))
  }

  test("physical draft deletion aborts open submissions without erasing their replay identity") {
    val proposed = submission()
    for
      _ <- seedDraft
      _ <- repository.put(proposed)
      _ <- PostgresMatchDraftCancellationRepository[IO](transactor).cancelDraftAndQueuedOcrJobs(
        draft,
        Instant.now(),
        owner,
      )
      state <- repository.find(proposed.id, owner)
      replay <- repository.put(proposed)
      count <- sql"SELECT count(*) FROM match_drafts WHERE id = ${draft.value}".query[
        Long
      ].unique.transact(transactor)
    yield
      assertEquals(count, 0L)
      assertEquals(state.map(_.status), Some("aborted"))
      assertEquals(replay.map(_.status), Right("aborted"))
      assert(state.flatMap(_.finishedAt).nonEmpty)
  }

  private def seedFailedImage: IO[Unit] = seedImage *> sql"""
    UPDATE source_images SET status = 'FAILED', failure_code = 'OBJECT_MISSING',
      updated_at = clock_timestamp() - interval '1 day' WHERE id = ${image.value}
  """.update.run.transact(transactor).void

  private def withRowLock[A](query: String)(run: (Connection, Int) => IO[A]): IO[A] =
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
      IO.blocking {
        connection.setAutoCommit(false)
        val statement = connection.createStatement()
        try
          statement.executeQuery(query).close()
          val rows = statement.executeQuery("SELECT pg_backend_pid()")
          try
            assert(rows.next())
            rows.getInt(1)
          finally rows.close()
        finally statement.close()
      }.flatMap(pid => run(connection, pid))
        .guarantee(IO.blocking(connection.rollback()))
    }

  // This scenario occupies all three pool connections. Observe the lock on the existing blocker
  // connection instead of making the observation itself wait for a fourth connection.
  private def awaitBlockedBy(connection: Connection, blockerPid: Int): IO[Unit] =
    def poll: IO[Unit] = IO.blocking {
      val statement = connection.prepareStatement(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)))"
      )
      try
        statement.setInt(1, blockerPid)
        val rows = statement.executeQuery()
        try
          assert(rows.next())
          rows.getBoolean(1)
        finally rows.close()
      finally statement.close()
    }.flatMap {
      case true => IO.unit
      case false => IO.cede *> IO.defer(poll)
    }
    poll.timeout(5.seconds)
