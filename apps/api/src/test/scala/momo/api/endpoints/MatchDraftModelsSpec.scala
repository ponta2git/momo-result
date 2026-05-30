package momo.api.endpoints

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftCommon}

final class MatchDraftModelsSpec extends FunSuite:
  private val now = Instant.parse("2026-05-31T00:00:00Z")

  test("detail response exposes confirmed match id for a confirmed draft"):
    val draft = MatchDraft.Confirmed(
      common = MatchDraftCommon(
        id = MatchDraftId.unsafeFromString("draft-confirmed-1"),
        createdByAccountId = AccountId.unsafeFromString("account-ponta"),
        createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
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
        createdAt = now,
        updatedAt = now,
      ),
      confirmedMatchIdValue = MatchId.unsafeFromString("match-confirmed-1"),
    )

    val response = MatchDraftDetailResponse.from(draft)

    assertEquals(response.status, "confirmed")
    assertEquals(response.confirmedMatchId, Some("match-confirmed-1"))
