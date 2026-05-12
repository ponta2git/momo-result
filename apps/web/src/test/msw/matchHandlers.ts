import { http, HttpResponse } from "msw";

import { mswState, now } from "@/test/msw/fixtures";

export const matchHandlers = [
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
      items: [
        {
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/total_assets`,
          kind: "total_assets",
        },
        {
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/revenue`,
          kind: "revenue",
        },
        {
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/incident_log`,
          kind: "incident_log",
        },
      ],
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
  http.post("/api/matches", async () =>
    HttpResponse.json({
      createdAt: now,
      heldEventId: "held-1",
      matchId: "match-1",
      matchNoInEvent: 1,
    }),
  ),
  http.get("/api/matches", ({ request }) => {
    const url = new URL(request.url);
    const heldEventId = url.searchParams.get("heldEventId");
    const gameTitleId = url.searchParams.get("gameTitleId");
    const seasonMasterId = url.searchParams.get("seasonMasterId");
    const status = url.searchParams.get("status");
    const kind = url.searchParams.get("kind");

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

    return HttpResponse.json({ items });
  }),
  http.get("/api/matches/:matchId", ({ params }) =>
    HttpResponse.json({
      createdAt: now,
      createdByMemberId: "member_ponta",
      gameTitleId: "gt_momotetsu_2",
      heldEventId: "held-1",
      layoutFamily: "momotetsu_2",
      mapMasterId: "map_east",
      matchId: params["matchId"],
      matchNoInEvent: 1,
      ownerMemberId: "member_ponta",
      playedAt: now,
      players: [
        {
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId: "member_ponta",
          playOrder: 1,
          rank: 1,
          revenueManYen: 200,
          totalAssetsManYen: 1000,
        },
        {
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId: "member_akane_mami",
          playOrder: 2,
          rank: 2,
          revenueManYen: 150,
          totalAssetsManYen: 800,
        },
        {
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId: "member_otaka",
          playOrder: 3,
          rank: 3,
          revenueManYen: 100,
          totalAssetsManYen: 600,
        },
        {
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId: "member_eu",
          playOrder: 4,
          rank: 4,
          revenueManYen: 50,
          totalAssetsManYen: 400,
        },
      ],
      seasonMasterId: "season_current",
    }),
  ),
  http.put("/api/matches/:matchId", async ({ params }) =>
    HttpResponse.json({
      createdAt: now,
      createdByMemberId: "member_ponta",
      gameTitleId: "gt_momotetsu_2",
      heldEventId: "held-1",
      layoutFamily: "momotetsu_2",
      mapMasterId: "map_east",
      matchId: params["matchId"],
      matchNoInEvent: 1,
      ownerMemberId: "member_ponta",
      playedAt: now,
      players: [],
      seasonMasterId: "season_current",
    }),
  ),
  http.delete("/api/matches/:matchId", ({ params }) =>
    HttpResponse.json({ deleted: true, matchId: params["matchId"] }),
  ),
];
