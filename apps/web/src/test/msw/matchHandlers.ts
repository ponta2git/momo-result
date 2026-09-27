import { http, HttpResponse } from "msw";

import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories/matchDetail";
import { makeMatchDraftReviewResponse } from "@/test/factories/matchDraftReview";
import { makeMatchDraftSourceImageResponses } from "@/test/factories/sourceImages";
import { mswState, now } from "@/test/msw/fixtures";

function pagination(page: number, pageSize: number, totalItems: number) {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
    lastCursor: totalPages > 1 ? `mock-cursor-${totalPages}` : null,
    nextCursor: page < totalPages ? `mock-cursor-${page + 1}` : null,
    page,
    pageSize,
    previousCursor: page > 1 ? `mock-cursor-${page - 1}` : null,
    totalItems,
    totalPages,
  };
}

export const matchHandlers = [
  http.get("/api/match-drafts/:draftId/review", ({ params }) =>
    HttpResponse.json(makeMatchDraftReviewResponse(String(params["draftId"]))),
  ),
  http.post("/api/match-drafts", async () =>
    HttpResponse.json({
      createdAt: now,
      matchDraftId: "draft-created-1",
      status: "ocr_running",
      updatedAt: now,
    }),
  ),
  http.post("/api/match-drafts/:draftId/cancel", ({ params }) =>
    HttpResponse.json({
      matchDraftId: params["draftId"],
      status: "cancelled",
    }),
  ),
  http.get("/api/match-drafts/:draftId", ({ params }) => {
    const draftId = String(params["draftId"]);
    return HttpResponse.json({
      createdAt: now,
      gameTitleId: "gt_momotetsu_2",
      heldEventId: "held-1",
      incidentLogDraftId: `${draftId}-incident`,
      incidentLogImageId: `${draftId}-img-incident`,
      mapMasterId: "map_east",
      matchDraftId: draftId,
      matchNoInEvent: 3,
      ownerMemberId: "member_ponta",
      playedAt: now,
      revenueDraftId: `${draftId}-revenue`,
      revenueImageId: `${draftId}-img-revenue`,
      seasonMasterId: "season_current",
      status: draftId === "draft-running-1" ? "ocr_running" : "needs_review",
      totalAssetsDraftId: `${draftId}-total`,
      totalAssetsImageId: `${draftId}-img-total`,
      updatedAt: now,
    });
  }),
  http.get("/api/match-drafts/:draftId/source-images", ({ params }) =>
    HttpResponse.json({
      items: makeMatchDraftSourceImageResponses(String(params["draftId"])),
    }),
  ),
  http.get(
    "/api/match-drafts/:draftId/source-images/:kind",
    () =>
      new HttpResponse("mock-image", {
        headers: {
          "Content-Type": "image/png",
        },
        status: 200,
      }),
  ),
  // Confirmation and update responses belong to each scenario, together with their payload oracle.
  http.get("/api/matches", ({ request }) => {
    const url = new URL(request.url);
    const heldEventId = url.searchParams.get("heldEventId");
    const gameTitleId = url.searchParams.get("gameTitleId");
    const seasonMasterId = url.searchParams.get("seasonMasterId");
    const status = url.searchParams.get("status");
    const kind = url.searchParams.get("kind");
    const cursor = url.searchParams.get("cursor");
    const page = cursor?.startsWith("mock-cursor-")
      ? Number(cursor.slice("mock-cursor-".length))
      : 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

    const items = mswState.matchList.filter((item) => {
      if (heldEventId && item.heldEventId !== heldEventId) return false;
      if (gameTitleId && item.gameTitleId !== gameTitleId) return false;
      if (seasonMasterId && item.seasonMasterId !== seasonMasterId) return false;
      if (kind && item.kind !== kind) return false;

      if (!status || status === "all") return true;
      if (status === "confirmed") return item.status === "confirmed";
      if (status === "ocr_running") return item.status === "ocr_running";
      if (status === "needs_review") return item.status === "needs_review";
      if (status === "pre_confirm") {
        return (
          item.status === "ocr_failed" ||
          item.status === "draft_ready" ||
          item.status === "needs_review"
        );
      }
      if (status === "incomplete") return item.status !== "confirmed";

      return true;
    });

    const offset = (page - 1) * pageSize;
    return HttpResponse.json({
      items: items.slice(offset, offset + pageSize).map((item) => ({
        ...item,
        heldAt: item.heldEventId === "held-1" ? now : item.playedAt,
        gameTitleName: mswState.gameTitles.find((title) => title.id === item.gameTitleId)?.name,
        seasonName: mswState.seasonMasters.find((season) => season.id === item.seasonMasterId)
          ?.name,
        mapName: mswState.mapMasters.find((map) => map.id === item.mapMasterId)?.name,
      })),
      pagination: pagination(page, pageSize, items.length),
    });
  }),
  http.get("/api/matches/summary", ({ request }) => {
    const url = new URL(request.url);
    const heldEventId = url.searchParams.get("heldEventId");
    const gameTitleId = url.searchParams.get("gameTitleId");
    const seasonMasterId = url.searchParams.get("seasonMasterId");
    const items = mswState.matchList.filter((item) => {
      if (heldEventId && item.heldEventId !== heldEventId) return false;
      if (gameTitleId && item.gameTitleId !== gameTitleId) return false;
      if (seasonMasterId && item.seasonMasterId !== seasonMasterId) return false;
      return item.kind === "match_draft";
    });
    return HttpResponse.json({
      incompleteCount: items.filter((item) => item.status !== "confirmed").length,
      needsReviewCount: items.filter((item) => item.status === "needs_review").length,
      ocrRunningCount: items.filter((item) => item.status === "ocr_running").length,
      preConfirmCount: items.filter((item) =>
        ["draft_ready", "needs_review", "ocr_failed"].includes(item.status),
      ).length,
    });
  }),
  http.get("/api/matches/:matchId/identity", ({ params }) =>
    HttpResponse.json({
      matchId: String(params["matchId"]),
      matchNoInEvent: 1,
      playedAt: now,
      gameTitleName: "桃太郎電鉄2",
      seasonName: "今シーズン",
    }),
  ),
  http.get("/api/matches/:matchId", ({ params }) =>
    HttpResponse.json(
      makeMatchDetail({
        createdAt: now,
        heldAt: now,
        playedAt: now,
        layoutFamily: "momotetsu_2",
        matchId: String(params["matchId"]),
        players: makeFourPlayerResults([
          { revenueManYen: 200, totalAssetsManYen: 1000 },
          { revenueManYen: 150, totalAssetsManYen: 800 },
          { revenueManYen: 100, totalAssetsManYen: 600 },
          { revenueManYen: 50, totalAssetsManYen: 400 },
        ]),
      }),
    ),
  ),
  http.delete("/api/matches/:matchId", ({ params }) =>
    HttpResponse.json({ deleted: true, matchId: params["matchId"] }),
  ),
];
