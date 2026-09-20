package momo.api.integration

import java.time.Instant

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMatchDraftReviewReadModel
import momo.api.domain.ids.{ImageId, MatchDraftId}
import momo.api.domain.{MatchDraftReview, ScreenType}

final class PostgresMatchDraftReviewReadModelSpec extends IntegrationSuite:
  private val at = Instant.parse("2026-09-01T00:00:00Z")
  private val id = MatchDraftId.unsafeFromString("review-snapshot")
  private def read = PostgresMatchDraftReviewReadModel[IO](transactor).find(id)

  test("review returns only referenced artifacts and available retained image descriptors"):
    for
      _ <- seed
      review <- read.map(_.getOrElse(fail("review was absent")))
      _ <- sql"UPDATE match_drafts SET source_images_deleted_at = $at WHERE id = 'review-snapshot'"
        .update.run.transact(transactor)
      purged <- read.map(_.getOrElse(fail("purged review was absent")))
      missing <- PostgresMatchDraftReviewReadModel[IO](transactor)
        .find(MatchDraftId.unsafeFromString("absent"))
    yield
      assertEquals(review.ocrDrafts.map(_.id.value), List("review-old"))
      assertEquals(
        review.sourceImages,
        List(MatchDraftReview.SourceImage(
          ScreenType.TotalAssets,
          ImageId.unsafeFromString("review-image-old"),
          "image/png",
        ))
      )
      assertEquals(purged.sourceImages, Nil)
      assertEquals(purged.ocrDrafts.map(_.id.value), List("review-old"))
      assertEquals(missing, None)

  test("a concurrent replacement cannot mix the draft pointer with old OCR or image metadata"):
    for
      _ <- seed
      changed <- Deferred[IO, Unit]
      commit <- Deferred[IO, Unit]
      writer <- Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
        IO.blocking(connection.setAutoCommit(false)) *>
          Resource.fromAutoCloseable(IO.blocking(connection.prepareStatement(
            "UPDATE match_drafts SET total_assets_draft_id = 'review-new', " +
              "total_assets_image_id = 'review-image-new', updated_at = updated_at + interval '1 second' " +
              "WHERE id = 'review-snapshot'"
          ))).use(statement => IO.blocking(statement.executeUpdate()).void) *>
          changed.complete(()) *> commit.get *> IO.blocking(connection.commit())
      }.start
      before <- (changed.get *> read).guarantee(commit.complete(()).void)
      _ <- writer.joinWithNever
      after <- read
    yield
      assertEquals(
        projection(before),
        Some(("review-old", "review-old", "review-image-old", "image/png"))
      )
      assertEquals(
        projection(after),
        Some(("review-new", "review-new", "review-image-new", "image/jpeg"))
      )

  private def projection(review: Option[MatchDraftReview])
      : Option[(String, String, String, String)] =
    review.flatMap(value =>
      for
        pointer <- value.draft.totalAssetsDraftId
        result <- value.ocrDrafts.headOption
        image <- value.sourceImages.headOption
      yield (pointer.value, result.id.value, image.imageId.value, image.mediaType)
    )

  private def seed: IO[Unit] = (for
    _ <- sql"""INSERT INTO match_drafts
      (id, created_by_account_id, status, total_assets_draft_id, total_assets_image_id,
       revenue_draft_id, revenue_image_id, incident_log_image_id, created_at, updated_at)
      VALUES ('review-snapshot', 'account_ponta', 'needs_review', 'review-old', 'review-image-old',
              'review-missing', 'review-image-missing', 'review-image-deleting', $at, $at)""".update.run
    _ <- List("review-old", "review-new", "review-unrelated").traverse_(draftId => sql"""
      INSERT INTO ocr_drafts (id, job_id, requested_screen_type, payload_json, warnings_json,
                             timings_ms_json, created_at, updated_at)
      VALUES ($draftId, ${s"job-$draftId"}, 'total_assets', '{}', '[]', '{}', $at, $at)
    """.update.run)
    _ <- List(
      ("review-image-old", "image/png"),
      ("review-image-new", "image/jpeg"),
      ("review-image-deleting", "image/png")
    )
      .traverse_ { case (imageId, mediaType) =>
        sql"""
        INSERT INTO source_images (id, owner_account_id, object_key, idempotency_key_hash, status, media_type,
          byte_length, sha256_hex, width, height, available_at, created_at, updated_at)
        VALUES ($imageId, 'account_ponta', ${s"source-images/$imageId.png"},
          md5($imageId) || md5($imageId), 'AVAILABLE', $mediaType,
          128, ${"b" * 64}, 1, 1, $at, $at, $at)
      """.update.run
      }
    _ <- sql"""UPDATE source_images SET status = 'DELETE_PENDING', delete_pending_at = $at
               WHERE id = 'review-image-deleting'""".update.run
  yield ()).transact(transactor)
