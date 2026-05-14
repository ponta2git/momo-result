package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.{AccountId, ImageId, MatchDraftId, MemberId, OcrDraftId}
import momo.api.domain.{MatchDraft, MatchDraftStatus, ScreenType}
import momo.api.repositories.postgres.PostgresMatchDraftsRepository

final class PostgresMatchDraftsRepositorySpec extends IntegrationSuite:

  private val createdAt = Instant.parse("2026-05-14T11:00:00Z")
  private val updatedAt = Instant.parse("2026-05-14T11:05:00Z")

  private def repo = PostgresMatchDraftsRepository[IO](transactor)

  test("update refuses to overwrite a terminal draft"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-terminal-update")
    for
      _ <- insertDraft(draftId.value, "cancelled")
      updated <- repo.update(editableDraft(draftId, MatchDraftStatus.DraftReady), updatedAt)
      status <- draftStatus(draftId.value)
    yield
      assertEquals(updated, false)
      assertEquals(status, "cancelled")

  test("cancel and markOcrFailed refuse terminal drafts"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-terminal-transition")
    for
      _ <- insertDraft(draftId.value, "cancelled")
      cancelled <- repo.cancel(draftId, updatedAt)
      failed <- repo.markOcrFailed(draftId, updatedAt)
      status <- draftStatus(draftId.value)
    yield
      assertEquals(cancelled, false)
      assertEquals(failed, false)
      assertEquals(status, "cancelled")

  test("attachOcrArtifacts refuses auto screen type for existing match drafts"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-auto-attach")
    for
      _ <- insertDraft(draftId.value, "draft_ready")
      attached <- repo.attachOcrArtifacts(
        draftId = draftId,
        screenType = ScreenType.Auto,
        sourceImageId = ImageId.unsafeFromString("image-auto-attach"),
        ocrDraftId = OcrDraftId.unsafeFromString("ocr-draft-auto-attach"),
        updatedAt = updatedAt,
      )
      status <- draftStatus(draftId.value)
    yield
      assertEquals(attached, false)
      assertEquals(status, "draft_ready")

  test("attachOcrArtifacts refuses to overwrite a slot with an active OCR job"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-active-slot")
    for
      _ <- insertDraftWithSlot(draftId.value, "ocr_running", Some("ocr-draft-active-slot"))
      _ <- insertOcrJob("job-active-slot", "ocr-draft-active-slot", "image-active-slot", "queued")
      attached <- repo.attachOcrArtifacts(
        draftId = draftId,
        screenType = ScreenType.TotalAssets,
        sourceImageId = ImageId.unsafeFromString("image-new-slot"),
        ocrDraftId = OcrDraftId.unsafeFromString("ocr-draft-new-slot"),
        updatedAt = updatedAt,
      )
      slot <- totalAssetsDraftId(draftId.value)
    yield
      assertEquals(attached, false)
      assertEquals(slot, Some("ocr-draft-active-slot"))

  test("attachOcrArtifacts allows replacing a slot after its OCR job is terminal"):
    val draftId = MatchDraftId.unsafeFromString("match-draft-terminal-slot")
    for
      _ <- insertDraftWithSlot(draftId.value, "ocr_failed", Some("ocr-draft-terminal-slot"))
      _ <- insertOcrJob(
        "job-terminal-slot",
        "ocr-draft-terminal-slot",
        "image-terminal-slot",
        "failed",
      )
      attached <- repo.attachOcrArtifacts(
        draftId = draftId,
        screenType = ScreenType.TotalAssets,
        sourceImageId = ImageId.unsafeFromString("image-replacement-slot"),
        ocrDraftId = OcrDraftId.unsafeFromString("ocr-draft-replacement-slot"),
        updatedAt = updatedAt,
      )
      slot <- totalAssetsDraftId(draftId.value)
      status <- draftStatus(draftId.value)
    yield
      assertEquals(attached, true)
      assertEquals(slot, Some("ocr-draft-replacement-slot"))
      assertEquals(status, "ocr_running")

  private def insertDraft(
      id: String,
      status: String,
  ): IO[Int] = insertDraftWithSlot(id, status, None)

  private def insertDraftWithSlot(
      id: String,
      status: String,
      totalAssetsDraftId: Option[String],
  ): IO[Int] = sql"""
    INSERT INTO match_drafts (
      id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
      created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', 'member_ponta', $status, $totalAssetsDraftId, $createdAt, $createdAt
    )
  """.update.run.transact(transactor)

  private def insertOcrJob(
      id: String,
      draftId: String,
      imageId: String,
      status: String,
  ): IO[Int] = sql"""
    INSERT INTO ocr_jobs (
      id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
      created_at, updated_at
    ) VALUES (
      $id, $draftId, $imageId, ${s"/tmp/$imageId.png"}, 'total_assets', $status, 0,
      $createdAt, $createdAt
    )
  """.update.run.transact(transactor)

  private def draftStatus(id: String): IO[String] = sql"""
    SELECT status FROM match_drafts WHERE id = $id
  """.query[String].unique.transact(transactor)

  private def totalAssetsDraftId(id: String): IO[Option[String]] = sql"""
    SELECT total_assets_draft_id FROM match_drafts WHERE id = $id
  """.query[Option[String]].unique.transact(transactor)

  private def editableDraft(id: MatchDraftId, status: MatchDraftStatus): MatchDraft =
    MatchDraft.fromInputs(
      id = id,
      createdByAccountId = AccountId.unsafeFromString("account_ponta"),
      createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
      status = status,
      heldEventId = None,
      matchNoInEvent = None,
      gameTitleId = None,
      layoutFamily = None,
      seasonMasterId = None,
      ownerMemberId = None,
      mapMasterId = None,
      playedAt = None,
      totalAssetsImageId = None,
      revenueImageId = None,
      incidentLogImageId = None,
      totalAssetsDraftId = None,
      revenueDraftId = None,
      incidentLogDraftId = None,
      sourceImagesRetainedUntil = None,
      sourceImagesDeletedAt = None,
      confirmedMatchId = None,
      createdAt = createdAt,
      updatedAt = createdAt,
    ).getOrElse(fail("test fixture draft should be valid"))
end PostgresMatchDraftsRepositorySpec
