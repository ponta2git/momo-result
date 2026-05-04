import { http, HttpResponse } from "msw";

const now = "2026-01-01T00:00:00.000Z";

type GameTitleRecord = {
  id: string;
  name: string;
  layoutFamily: string;
  displayOrder: number;
  createdAt: string;
};
type ScopedMasterRecord = {
  id: string;
  gameTitleId: string;
  name: string;
  displayOrder: number;
  createdAt: string;
};
type IncidentRecord = {
  id: string;
  key: string;
  displayName: string;
  displayOrder: number;
};

const gameTitlesStore: GameTitleRecord[] = [
  {
    id: "gt_momotetsu_2",
    name: "桃太郎電鉄2",
    layoutFamily: "momotetsu_2",
    displayOrder: 1,
    createdAt: now,
  },
];
const mapMastersStore: ScopedMasterRecord[] = [
  {
    id: "map_east",
    gameTitleId: "gt_momotetsu_2",
    name: "東日本編",
    displayOrder: 1,
    createdAt: now,
  },
];
const seasonMastersStore: ScopedMasterRecord[] = [
  {
    id: "season_current",
    gameTitleId: "gt_momotetsu_2",
    name: "今シーズン",
    displayOrder: 1,
    createdAt: now,
  },
];
const incidentMastersSeed: IncidentRecord[] = [
  { id: "incident_destination", key: "destination", displayName: "目的地", displayOrder: 1 },
  { id: "incident_plus_station", key: "plusStation", displayName: "プラス駅", displayOrder: 2 },
  { id: "incident_minus_station", key: "minusStation", displayName: "マイナス駅", displayOrder: 3 },
  { id: "incident_card_station", key: "cardStation", displayName: "カード駅", displayOrder: 4 },
  { id: "incident_card_shop", key: "cardShop", displayName: "カード売り場", displayOrder: 5 },
  { id: "incident_suri_no_ginji", key: "suriNoGinji", displayName: "スリの銀次", displayOrder: 6 },
];
const playerField = (value: unknown, confidence = 0.96) => ({
  value,
  raw_text: value == null ? null : String(value),
  confidence,
  warnings: [],
});
const draftPayload = {
  requested_screen_type: "total_assets",
  detected_screen_type: "total_assets",
  profile_id: "momotetsu_2.total_assets.v1",
  players: [
    {
      raw_player_name: playerField("ぽんた"),
      member_id: "member_ponta",
      play_order: playerField(1),
      rank: playerField(1),
      total_assets_man_yen: playerField(1000),
      revenue_man_yen: playerField(100),
      incidents: {},
    },
  ],
  category_payload: {},
  warnings: [],
  raw_snippets: null,
};

const matchListStore = [
  {
    kind: "match_draft",
    id: "draft-running-1",
    matchDraftId: "draft-running-1",
    status: "ocr_running",
    heldEventId: "held-1",
    matchNoInEvent: 2,
    gameTitleId: "gt_momotetsu_2",
    seasonMasterId: "season_current",
    mapMasterId: "map_east",
    ownerMemberId: "member_ponta",
    playedAt: now,
    createdAt: now,
    updatedAt: "2026-01-02T01:00:00.000Z",
    ranks: [],
  },
  {
    kind: "match_draft",
    id: "draft-review-1",
    matchDraftId: "draft-review-1",
    status: "needs_review",
    heldEventId: "held-1",
    matchNoInEvent: 3,
    gameTitleId: "gt_momotetsu_2",
    seasonMasterId: "season_current",
    mapMasterId: "map_east",
    ownerMemberId: "member_ponta",
    playedAt: now,
    createdAt: now,
    updatedAt: "2026-01-02T02:00:00.000Z",
    ranks: [],
  },
  {
    kind: "match",
    id: "match-1",
    matchId: "match-1",
    status: "confirmed",
    heldEventId: "held-1",
    matchNoInEvent: 1,
    gameTitleId: "gt_momotetsu_2",
    seasonMasterId: "season_current",
    mapMasterId: "map_east",
    ownerMemberId: "member_ponta",
    playedAt: now,
    createdAt: now,
    updatedAt: now,
    ranks: [
      { memberId: "member_ponta", rank: 1, playOrder: 1 },
      { memberId: "member_akane_mami", rank: 2, playOrder: 2 },
      { memberId: "member_otaka", rank: 3, playOrder: 3 },
      { memberId: "member_eu", rank: 4, playOrder: 4 },
    ],
  },
];

export const handlers = [
  http.get("/api/auth/me", ({ request }) => {
    const devUser = request.headers.get("X-Dev-User");
    if (!devUser) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "dev user is required",
          code: "UNAUTHORIZED",
        },
        { status: 401 },
      );
    }
    return HttpResponse.json({ memberId: devUser, displayName: devUser });
  }),
  http.post("/api/uploads/images", async () =>
    HttpResponse.json({
      imageId: "image-1",
      imagePath: "/tmp/ignored.png",
      mediaType: "image/png",
      sizeBytes: 100,
    }),
  ),
  http.post("/api/ocr-jobs", async () =>
    HttpResponse.json({
      jobId: "job-1",
      draftId: "draft-1",
      status: "queued",
    }),
  ),
  http.get("/api/ocr-jobs/:jobId", () =>
    HttpResponse.json({
      jobId: "job-1",
      draftId: "draft-1",
      imageId: "image-1",
      imagePath: "/tmp/ignored.png",
      requestedImageType: "auto",
      detectedImageType: "total_assets",
      status: "succeeded",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    }),
  ),
  http.get("/api/ocr-drafts/:draftId", () =>
    HttpResponse.json({
      draftId: "draft-1",
      jobId: "job-1",
      requestedImageType: "auto",
      detectedImageType: "total_assets",
      profileId: "momotetsu_2.total_assets.v1",
      payloadJson: { players: [] },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: now,
      updatedAt: now,
    }),
  ),
  http.get("/api/ocr-drafts", ({ request }) => {
    const url = new URL(request.url);
    const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
    if (ids.length === 0) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Validation Failed",
          status: 422,
          detail: "ids query must contain at least 1 id.",
          code: "VALIDATION_FAILED",
        },
        { status: 422 },
      );
    }
    return HttpResponse.json({
      items: ids.map((draftId) => ({
        draftId,
        jobId: `job-${draftId}`,
        requestedImageType: "auto",
        detectedImageType: "total_assets",
        profileId: "momotetsu_2.total_assets.v1",
        payloadJson: draftPayload,
        warningsJson: [],
        timingsMsJson: {},
        createdAt: now,
        updatedAt: now,
      })),
    });
  }),
  http.get("/api/held-events", () =>
    HttpResponse.json({
      items: [
        {
          id: "held-1",
          heldAt: now,
          matchCount: 0,
        },
      ],
    }),
  ),
  http.post("/api/held-events", async () =>
    HttpResponse.json({
      id: "held-created",
      heldAt: now,
      matchCount: 0,
    }),
  ),
  http.post("/api/match-drafts", async () =>
    HttpResponse.json({
      matchDraftId: "draft-created-1",
      status: "ocr_running",
      createdAt: now,
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
      matchDraftId: draftId,
      status: draftId === "draft-running-1" ? "ocr_running" : "needs_review",
      heldEventId: "held-1",
      matchNoInEvent: 3,
      gameTitleId: "gt_momotetsu_2",
      seasonMasterId: "season_current",
      ownerMemberId: "member_ponta",
      mapMasterId: "map_east",
      playedAt: now,
      totalAssetsDraftId: `${draftId}-total`,
      revenueDraftId: `${draftId}-revenue`,
      incidentLogDraftId: `${draftId}-incident`,
      totalAssetsImageId: `${draftId}-img-total`,
      revenueImageId: `${draftId}-img-revenue`,
      incidentLogImageId: `${draftId}-img-incident`,
      createdAt: now,
      updatedAt: now,
    });
  }),
  http.get("/api/match-drafts/:draftId/source-images", ({ params }) =>
    HttpResponse.json({
      items: [
        {
          kind: "total_assets",
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/total_assets`,
        },
        {
          kind: "revenue",
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/revenue`,
        },
        {
          kind: "incident_log",
          contentType: "image/png",
          createdAt: now,
          imageUrl: `/api/match-drafts/${params["draftId"]}/source-images/incident_log`,
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
      matchId: "match-1",
      heldEventId: "held-1",
      matchNoInEvent: 1,
      createdAt: now,
    }),
  ),
  http.get("/api/matches", ({ request }) => {
    const url = new URL(request.url);
    const heldEventId = url.searchParams.get("heldEventId");
    const gameTitleId = url.searchParams.get("gameTitleId");
    const seasonMasterId = url.searchParams.get("seasonMasterId");
    const status = url.searchParams.get("status");
    const kind = url.searchParams.get("kind");

    const items = matchListStore.filter((item) => {
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
      matchId: params["matchId"],
      heldEventId: "held-1",
      matchNoInEvent: 1,
      gameTitleId: "gt_momotetsu_2",
      layoutFamily: "momotetsu_2",
      seasonMasterId: "season_current",
      ownerMemberId: "member_ponta",
      mapMasterId: "map_east",
      playedAt: now,
      createdByMemberId: "member_ponta",
      createdAt: now,
      players: [
        {
          memberId: "member_ponta",
          playOrder: 1,
          rank: 1,
          totalAssetsManYen: 1000,
          revenueManYen: 200,
          incidents: {
            destination: 0,
            plusStation: 0,
            minusStation: 0,
            cardStation: 0,
            cardShop: 0,
            suriNoGinji: 0,
          },
        },
        {
          memberId: "member_akane_mami",
          playOrder: 2,
          rank: 2,
          totalAssetsManYen: 800,
          revenueManYen: 150,
          incidents: {
            destination: 0,
            plusStation: 0,
            minusStation: 0,
            cardStation: 0,
            cardShop: 0,
            suriNoGinji: 0,
          },
        },
        {
          memberId: "member_otaka",
          playOrder: 3,
          rank: 3,
          totalAssetsManYen: 600,
          revenueManYen: 100,
          incidents: {
            destination: 0,
            plusStation: 0,
            minusStation: 0,
            cardStation: 0,
            cardShop: 0,
            suriNoGinji: 0,
          },
        },
        {
          memberId: "member_eu",
          playOrder: 4,
          rank: 4,
          totalAssetsManYen: 400,
          revenueManYen: 50,
          incidents: {
            destination: 0,
            plusStation: 0,
            minusStation: 0,
            cardStation: 0,
            cardShop: 0,
            suriNoGinji: 0,
          },
        },
      ],
    }),
  ),
  http.get("/api/exports/matches", ({ request }) => {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "tsv" ? "tsv" : "csv";
    return new HttpResponse(
      format === "tsv"
        ? "シーズン\tシーズンNo.\r\n今シーズン\t1\r\n"
        : "シーズン,シーズンNo.\r\n今シーズン,1\r\n",
      {
        headers: {
          "Content-Type":
            format === "tsv"
              ? "text/tab-separated-values; charset=utf-8"
              : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="momo-results-all.${format}"`,
        },
      },
    );
  }),
  http.put("/api/matches/:matchId", async ({ params }) =>
    HttpResponse.json({
      matchId: params["matchId"],
      heldEventId: "held-1",
      matchNoInEvent: 1,
      gameTitleId: "gt_momotetsu_2",
      layoutFamily: "momotetsu_2",
      seasonMasterId: "season_current",
      ownerMemberId: "member_ponta",
      mapMasterId: "map_east",
      playedAt: now,
      createdByMemberId: "member_ponta",
      createdAt: now,
      players: [],
    }),
  ),
  http.delete("/api/matches/:matchId", ({ params }) =>
    HttpResponse.json({ matchId: params["matchId"], deleted: true }),
  ),
  http.get("/api/game-titles", () =>
    HttpResponse.json({
      items: gameTitlesStore.map((item) => ({ ...item })),
    }),
  ),
  http.post("/api/game-titles", async ({ request }) => {
    const body = (await request.json()) as {
      id: string;
      name: string;
      layoutFamily: string;
    };
    const created = {
      id: body.id,
      name: body.name,
      layoutFamily: body.layoutFamily,
      displayOrder: gameTitlesStore.length + 1,
      createdAt: now,
    };
    gameTitlesStore.push(created);
    return HttpResponse.json(created);
  }),
  http.get("/api/map-masters", ({ request }) => {
    const url = new URL(request.url);
    const gameTitleId = url.searchParams.get("gameTitleId");
    const items = gameTitleId
      ? mapMastersStore.filter((item) => item.gameTitleId === gameTitleId)
      : mapMastersStore;
    return HttpResponse.json({ items: items.map((item) => ({ ...item })) });
  }),
  http.post("/api/map-masters", async ({ request }) => {
    const body = (await request.json()) as {
      id: string;
      gameTitleId: string;
      name: string;
    };
    const created = {
      id: body.id,
      gameTitleId: body.gameTitleId,
      name: body.name,
      displayOrder: mapMastersStore.length + 1,
      createdAt: now,
    };
    mapMastersStore.push(created);
    return HttpResponse.json(created);
  }),
  http.get("/api/season-masters", ({ request }) => {
    const url = new URL(request.url);
    const gameTitleId = url.searchParams.get("gameTitleId");
    const items = gameTitleId
      ? seasonMastersStore.filter((item) => item.gameTitleId === gameTitleId)
      : seasonMastersStore;
    return HttpResponse.json({ items: items.map((item) => ({ ...item })) });
  }),
  http.post("/api/season-masters", async ({ request }) => {
    const body = (await request.json()) as {
      id: string;
      gameTitleId: string;
      name: string;
    };
    const created = {
      id: body.id,
      gameTitleId: body.gameTitleId,
      name: body.name,
      displayOrder: seasonMastersStore.length + 1,
      createdAt: now,
    };
    seasonMastersStore.push(created);
    return HttpResponse.json(created);
  }),
  http.get("/api/incident-masters", () =>
    HttpResponse.json({ items: incidentMastersSeed.map((item) => ({ ...item })) }),
  ),
  http.delete("/api/ocr-jobs/:jobId", ({ params }) =>
    HttpResponse.json({
      jobId: params["jobId"],
      status: "cancelled",
    }),
  ),
];
