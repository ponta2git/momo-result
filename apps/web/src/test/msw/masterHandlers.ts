import { http, HttpResponse } from "msw";

import type { components } from "@/shared/api/generated";
import { incidentMastersSeed, mswState, now } from "@/test/msw/fixtures";

export const masterHandlers = [
  http.get("/api/game-titles", () =>
    HttpResponse.json({
      items: mswState.gameTitles.map((item) => ({ ...item })),
    }),
  ),
  http.post("/api/game-titles", async ({ request }) => {
    const body = (await request.json()) as {
      id: string;
      layoutFamily: string;
      name: string;
    };
    const created = {
      createdAt: now,
      displayOrder: mswState.gameTitles.length + 1,
      id: body.id,
      layoutFamily: body.layoutFamily,
      name: body.name,
    };
    mswState.gameTitles.push(created);
    return HttpResponse.json(created);
  }),
  http.patch("/api/game-titles/:id", async ({ params, request }) => {
    const id = String(params["id"]);
    const body = (await request.json()) as components["schemas"]["UpdateGameTitleRequest"];
    mswState.gameTitles = mswState.gameTitles.map((item) =>
      item.id === id ? { ...item, layoutFamily: body.layoutFamily, name: body.name } : item,
    );
    return HttpResponse.json(mswState.gameTitles.find((item) => item.id === id));
  }),
  http.delete("/api/game-titles/:id", ({ params }) => {
    const id = String(params["id"]);
    mswState.gameTitles = mswState.gameTitles.filter((item) => item.id !== id);
    mswState.mapMasters = mswState.mapMasters.filter((item) => item.gameTitleId !== id);
    mswState.seasonMasters = mswState.seasonMasters.filter((item) => item.gameTitleId !== id);
    return HttpResponse.json({ deleted: true, id });
  }),
  http.get("/api/map-masters", ({ request }) => {
    const url = new URL(request.url);
    const gameTitleId = url.searchParams.get("gameTitleId");
    const items = gameTitleId
      ? mswState.mapMasters.filter((item) => item.gameTitleId === gameTitleId)
      : mswState.mapMasters;
    return HttpResponse.json({ items: structuredClone(items) });
  }),
  http.post("/api/map-masters", async ({ request }) => {
    const body = (await request.json()) as {
      gameTitleId: string;
      id: string;
      name: string;
    };
    const created = {
      createdAt: now,
      displayOrder: mswState.mapMasters.length + 1,
      gameTitleId: body.gameTitleId,
      id: body.id,
      name: body.name,
    };
    mswState.mapMasters.push(created);
    return HttpResponse.json(created);
  }),
  http.patch("/api/map-masters/:id", async ({ params, request }) => {
    const id = String(params["id"]);
    const body = (await request.json()) as components["schemas"]["UpdateMapMasterRequest"];
    mswState.mapMasters = mswState.mapMasters.map((item) =>
      item.id === id ? { ...item, name: body.name } : item,
    );
    return HttpResponse.json(mswState.mapMasters.find((item) => item.id === id));
  }),
  http.delete("/api/map-masters/:id", ({ params }) => {
    const id = String(params["id"]);
    mswState.mapMasters = mswState.mapMasters.filter((item) => item.id !== id);
    return HttpResponse.json({ deleted: true, id });
  }),
  http.get("/api/season-masters", ({ request }) => {
    const url = new URL(request.url);
    const gameTitleId = url.searchParams.get("gameTitleId");
    const items = gameTitleId
      ? mswState.seasonMasters.filter((item) => item.gameTitleId === gameTitleId)
      : mswState.seasonMasters;
    return HttpResponse.json({ items: structuredClone(items) });
  }),
  http.post("/api/season-masters", async ({ request }) => {
    const body = (await request.json()) as {
      gameTitleId: string;
      id: string;
      name: string;
    };
    const created = {
      createdAt: now,
      displayOrder: mswState.seasonMasters.length + 1,
      gameTitleId: body.gameTitleId,
      id: body.id,
      name: body.name,
    };
    mswState.seasonMasters.push(created);
    return HttpResponse.json(created);
  }),
  http.patch("/api/season-masters/:id", async ({ params, request }) => {
    const id = String(params["id"]);
    const body = (await request.json()) as components["schemas"]["UpdateSeasonMasterRequest"];
    mswState.seasonMasters = mswState.seasonMasters.map((item) =>
      item.id === id ? { ...item, name: body.name } : item,
    );
    return HttpResponse.json(mswState.seasonMasters.find((item) => item.id === id));
  }),
  http.delete("/api/season-masters/:id", ({ params }) => {
    const id = String(params["id"]);
    mswState.seasonMasters = mswState.seasonMasters.filter((item) => item.id !== id);
    return HttpResponse.json({ deleted: true, id });
  }),
  http.get("/api/incident-masters", () =>
    HttpResponse.json({ items: structuredClone(incidentMastersSeed) }),
  ),
  http.get("/api/member-aliases", ({ request }) => {
    const url = new URL(request.url);
    const memberId = url.searchParams.get("memberId");
    const items = memberId
      ? mswState.memberAliases.filter((item) => item.memberId === memberId)
      : mswState.memberAliases;
    return HttpResponse.json({ items: structuredClone(items) });
  }),
  http.post("/api/member-aliases", async ({ request }) => {
    const body = (await request.json()) as components["schemas"]["CreateMemberAliasRequest"];
    const created = {
      alias: body.alias,
      createdAt: now,
      id: `alias-${mswState.memberAliases.length + 1}`,
      memberId: body.memberId,
    };
    mswState.memberAliases.push(created);
    return HttpResponse.json(created);
  }),
  http.patch("/api/member-aliases/:id", async ({ params, request }) => {
    const id = String(params["id"]);
    const body = (await request.json()) as components["schemas"]["UpdateMemberAliasRequest"];
    mswState.memberAliases = mswState.memberAliases.map((item) =>
      item.id === id ? { ...item, alias: body.alias, memberId: body.memberId } : item,
    );
    return HttpResponse.json(mswState.memberAliases.find((item) => item.id === id));
  }),
  http.delete("/api/member-aliases/:id", ({ params }) => {
    const id = String(params["id"]);
    mswState.memberAliases = mswState.memberAliases.filter((item) => item.id !== id);
    return HttpResponse.json({ deleted: true, id });
  }),
];
