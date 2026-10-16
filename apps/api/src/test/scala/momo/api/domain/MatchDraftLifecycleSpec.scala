package momo.api.domain

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*

final class MatchDraftLifecycleSpec extends FunSuite:
  private val createdAt = Instant.parse("2026-05-04T10:00:00Z")

  private def newEditing(status: MatchDraftStatus): MatchDraft.Editable = MatchDraft.editable(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString("d1"),
      createdByAccountId = AccountId.unsafeFromString("account_m1"),
      createdByMemberId = Some(MemberId.unsafeFromString("m1")),
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
      createdAt = createdAt,
      updatedAt = createdAt,
    ),
    status = status,
  ).getOrElse(fail(s"invalid editable status=${status.wire}"))

  test("smart factory rejects status=Confirmed without confirmedMatchId"):
    val result = MatchDraft.fromInputs(
      id = MatchDraftId.unsafeFromString("d2"),
      createdByAccountId = AccountId.unsafeFromString("account_m1"),
      createdByMemberId = Some(MemberId.unsafeFromString("m1")),
      status = MatchDraftStatus.Confirmed,
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
    )
    assertEquals(result, Left(MatchDraftError.ConfirmedRequiresMatchId))

  test("OCR slot projection keeps the domain status precedence in one pure rule"):
    def slot(status: Option[OcrJobStatus], warnings: Boolean) = MatchDraftOcrSlot(status, warnings)

    assertEquals(
      MatchDraftOcrStatus.project(
        MatchDraftStatus.OcrRunning,
        List(slot(Some(OcrJobStatus.Succeeded), warnings = false), slot(None, warnings = false)),
      ),
      MatchDraftStatus.OcrRunning,
    )
    assertEquals(
      MatchDraftOcrStatus.project(
        MatchDraftStatus.OcrRunning,
        List(
          slot(Some(OcrJobStatus.Succeeded), warnings = true),
          slot(Some(OcrJobStatus.Failed), warnings = false),
        ),
      ),
      MatchDraftStatus.OcrFailed,
    )
    assertEquals(
      MatchDraftOcrStatus.project(
        MatchDraftStatus.OcrRunning,
        List(slot(Some(OcrJobStatus.Succeeded), warnings = true)),
      ),
      MatchDraftStatus.NeedsReview,
    )
    assertEquals(
      MatchDraftOcrStatus.project(
        MatchDraftStatus.OcrRunning,
        List(slot(Some(OcrJobStatus.Succeeded), warnings = false)),
      ),
      MatchDraftStatus.DraftReady,
    )
    assertEquals(
      MatchDraftOcrStatus.project(MatchDraftStatus.NeedsReview, List(slot(None, warnings = false))),
      MatchDraftStatus.NeedsReview,
    )

  test("confirmation requires each requested OCR reference to match the draft"):
    import MatchDraftConfirmability.Rejection
    val ref = Some(OcrDraftId.unsafeFromString("ocr-reference"))
    val draft = newEditing(MatchDraftStatus.DraftReady).withCommon(_.copy(
      totalAssetsDraftId = ref,
      revenueDraftId = ref,
      incidentLogDraftId = ref,
    ))
    assertEquals(MatchDraftConfirmability.validate(draft, ref, ref, ref), Right(()))
    assertEquals(
      MatchDraftConfirmability.validate(draft, None, ref, ref),
      Left(Rejection.TotalAssetsReference),
    )
    assertEquals(
      MatchDraftConfirmability.validate(draft, ref, None, ref),
      Left(Rejection.RevenueReference),
    )
    assertEquals(
      MatchDraftConfirmability.validate(draft, ref, ref, None),
      Left(Rejection.IncidentLogReference),
    )

  test("confirmation rejects running and terminal drafts even with matching references"):
    val running = newEditing(MatchDraftStatus.OcrRunning)
    val confirmed =
      MatchDraft.Confirmed(running.common, MatchId.unsafeFromString("match-confirmed"))
    val cancelled = MatchDraft.Cancelled(running.common)
    List(running, confirmed, cancelled).foreach { draft =>
      assertEquals(
        MatchDraftConfirmability.validate(draft, None, None, None),
        Left(MatchDraftConfirmability.Rejection.Status(draft.status)),
      )
    }

  test("slot accessors expose source images and OCR drafts in screen order"):
    val totalImage = ImageId.unsafeFromString("image-total")
    val revenueImage = ImageId.unsafeFromString("image-revenue")
    val totalDraft = OcrDraftId.unsafeFromString("draft-total")
    val incidentDraft = OcrDraftId.unsafeFromString("draft-incident")
    val draft = newEditing(MatchDraftStatus.DraftReady).withCommon(_.copy(
      totalAssetsImageId = Some(totalImage),
      revenueImageId = Some(revenueImage),
      totalAssetsDraftId = Some(totalDraft),
      incidentLogDraftId = Some(incidentDraft),
    ))

    assertEquals(draft.sourceImageIds, List(totalImage, revenueImage))
    assertEquals(draft.ocrDraftIds, List(totalDraft, incidentDraft))
    assertEquals(draft.sourceImageId(ScreenType.TotalAssets), Some(totalImage))
    assertEquals(draft.sourceImageId(ScreenType.Auto), None)
    assertEquals(draft.ocrDraftId(ScreenType.IncidentLog), Some(incidentDraft))
end MatchDraftLifecycleSpec
