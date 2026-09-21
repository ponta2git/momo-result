package momo.api.integration

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*

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

  private def seedImage: IO[Unit] =
    val now = Instant.now()
    val reservation = SourceImageReservation(
      image,
      owner,
      SourceImageObjectKey.forImage(image, "png").fold(fail(_), identity),
      key,
      "image/png",
      128,
      Sha256Hex.fromString(digest).fold(fail(_), identity),
      1,
      1,
      now
    )
    images.reserveWithinQuota(reservation, SourceImageQuota(100, 1024 * 1024)) *>
      images.markAvailable(image, None, now).void

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

  test("GET waits for a terminal writer and returns one consistent header and member state") {
    val proposed = submission()
    for
      _ <- seedDraft
      _ <- repository.put(proposed)
      locked <- Deferred[IO, Int]
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
                  s"UPDATE ocr_submissions SET status = 'settled', finished_at = clock_timestamp() WHERE id = '${proposed.id}'"
                )
                val rows = statement.executeQuery("SELECT pg_backend_pid()")
                try
                  assert(rows.next())
                  rows.getInt(1)
                finally rows.close()
              finally statement.close()
            }.flatMap(locked.complete) *> release.get *> IO.blocking(connection.commit()))
              .guarantee(IO.blocking(connection.rollback()))
          writer.background.use { completed =>
            for
              pid <- locked.get
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
        Instant.now()
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
