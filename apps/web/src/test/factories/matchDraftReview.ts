import type { MatchDraftDetailResponse, MatchDraftReviewResponse } from "@/shared/api/matchDrafts";
import { makeMatchDraftSourceImageResponses } from "@/test/factories/sourceImages";
import { draftPayload, now } from "@/test/msw/fixtures";

export function makeMatchDraftReviewResponse(
  draftId: string,
  overrides: Partial<MatchDraftDetailResponse> = {},
): MatchDraftReviewResponse {
  const draft: MatchDraftDetailResponse = {
    createdAt: now,
    updatedAt: now,
    matchDraftId: draftId,
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    mapMasterId: "map_east",
    matchNoInEvent: 3,
    ownerMemberId: "member_ponta",
    playedAt: now,
    seasonMasterId: "season_current",
    status: draftId === "draft-running-1" ? "ocr_running" : "needs_review",
    totalAssetsDraftId: `${draftId}-total`,
    revenueDraftId: `${draftId}-revenue`,
    incidentLogDraftId: `${draftId}-incident`,
    totalAssetsImageId: `${draftId}-img-total`,
    revenueImageId: `${draftId}-img-revenue`,
    incidentLogImageId: `${draftId}-img-incident`,
    ...overrides,
  };
  return {
    draft,
    ocrDrafts: [draft.totalAssetsDraftId, draft.revenueDraftId, draft.incidentLogDraftId].flatMap(
      (id) =>
        id
          ? [
              {
                draftId: id,
                jobId: `job-${id}`,
                requestedScreenType: "auto",
                detectedScreenType: "total_assets",
                payloadJson: draftPayload,
                warningsJson: [],
                timingsMsJson: {},
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
    ),
    sourceImages: makeMatchDraftSourceImageResponses(draftId),
  };
}
