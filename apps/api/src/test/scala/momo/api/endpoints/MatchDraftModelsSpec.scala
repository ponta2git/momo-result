package momo.api.endpoints

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftCommon, MatchDraftReview, ScreenType}

final class MatchDraftModelsSpec extends FunSuite:
  private val now = Instant.parse("2026-05-31T00:00:00Z")

  test("detail response exposes confirmed match id for a confirmed draft"):
    val draft = confirmedDraft

    val response = MatchDraftDetailResponse.from(draft)

    assertEquals(response.status, "confirmed")
    assertEquals(response.confirmedMatchId, Some("match-confirmed-1"))
    assertEquals(response.layoutFamily, Some("world"))

  test("review descriptors pin and encode the image captured by the read model"):
    val review = MatchDraftReview(
      confirmedDraft,
      Nil,
      List(MatchDraftReview.SourceImage(
        ScreenType.TotalAssets,
        ImageId.unsafeFromString("image+version&one"),
        "image/png",
      )),
    )
    val response = MatchDraftReviewResponse.from(review).getOrElse(fail("expected review response"))
    assertEquals(
      response.sourceImages.map(_.imageUrl),
      List(
        "/api/match-drafts/draft-confirmed-1/source-images/total_assets?imageId=image%2Bversion%26one"
      ),
    )

  private def confirmedDraft: MatchDraft = MatchDraft.Confirmed(
    common = MatchDraftCommon(
      id = MatchDraftId.unsafeFromString("draft-confirmed-1"),
      createdByAccountId = AccountId.unsafeFromString("account-ponta"),
      createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
      heldEventId = None,
      matchNoInEvent = None,
      gameTitleId = None,
      layoutFamily = Some("world"),
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
      createdAt = now,
      updatedAt = now,
    ),
    confirmedMatchIdValue = MatchId.unsafeFromString("match-confirmed-1"),
  )
