import type { APIRequestContext } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import { expectGeneratedId, postJson } from "../support";
import type { E2eRun } from "../support";

export async function seedMasterContext(request: APIRequestContext, e2eRun: E2eRun) {
  const { masterIdSuffix } = e2eRun;
  const gameTitleId = `gt_e2e_${masterIdSuffix}`;
  const seasonMasterId = `season_e2e_${masterIdSuffix}`;
  const mapMasterId = `map_e2e_${masterIdSuffix}`;
  const gameTitleName = `桃太郎電鉄2 E2E ${masterIdSuffix}`;
  const seasonName = `E2Eシーズン ${masterIdSuffix}`;
  const mapName = `E2Eマップ ${masterIdSuffix}`;

  await postJson(request, e2eRun, "/api/game-titles", {
    id: gameTitleId,
    layoutFamily: "momotetsu_2",
    name: gameTitleName,
  } satisfies components["schemas"]["CreateGameTitleRequest"]);
  e2eRun.trackGameTitle(gameTitleId);
  await postJson(request, e2eRun, "/api/season-masters", {
    gameTitleId,
    id: seasonMasterId,
    name: seasonName,
  } satisfies components["schemas"]["CreateSeasonMasterRequest"]);
  e2eRun.trackSeasonMaster(seasonMasterId);
  await postJson(request, e2eRun, "/api/map-masters", {
    gameTitleId,
    id: mapMasterId,
    name: mapName,
  } satisfies components["schemas"]["CreateMapMasterRequest"]);
  e2eRun.trackMapMaster(mapMasterId);

  return { gameTitleId, gameTitleName, mapMasterId, mapName, seasonMasterId, seasonName };
}

export async function seedHeldEventContext(request: APIRequestContext, e2eRun: E2eRun) {
  const masters = await seedMasterContext(request, e2eRun);
  // Historical fixtures must not take the latest-event shortcuts from the create/OCR flow.
  const localDateTime = e2eRun.uniqueLocalDateTime(2000);
  const playedAt = new Date(`${localDateTime}:00+09:00`).toISOString();
  const heldEvent = await postJson(request, e2eRun, "/api/held-events", {
    heldAt: playedAt,
  } satisfies components["schemas"]["CreateHeldEventRequest"]);
  const heldEventId = expectGeneratedId(heldEvent["id"], "held event ID");
  e2eRun.trackHeldEvent(heldEventId);
  return {
    ...masters,
    heldEventId,
    heldEventLabelPrefix: localDateTime.replaceAll("-", "/").replace("T", " "),
    playedAt,
  };
}

export async function seedConfirmedContext(request: APIRequestContext, e2eRun: E2eRun) {
  const context = await seedHeldEventContext(request, e2eRun);
  const match = await postJson(request, e2eRun, "/api/matches", {
    draftIds: {},
    gameTitleId: context.gameTitleId,
    heldEventId: context.heldEventId,
    mapMasterId: context.mapMasterId,
    matchNoInEvent: 1,
    ownerMemberId: "member_ponta",
    playedAt: context.playedAt,
    players: makePlayers(),
    seasonMasterId: context.seasonMasterId,
  } satisfies components["schemas"]["ConfirmMatchRequest"]);
  const matchId = expectGeneratedId(match["matchId"], "match ID");
  e2eRun.trackMatch(matchId);

  return {
    ...context,
    matchId,
  };
}

function makePlayers(): Array<components["schemas"]["PlayerResultRequest"]> {
  return ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"].map(
    (memberId, index) => ({
      incidents: {
        cardShop: 0,
        cardStation: 0,
        destination: 0,
        minusStation: 0,
        plusStation: 0,
        suriNoGinji: 0,
      },
      memberId,
      playOrder: index + 1,
      rank: index + 1,
      revenueManYen: (4 - index) * 10,
      totalAssetsManYen: (4 - index) * 100,
    }),
  );
}

export async function seedUiContext(request: APIRequestContext, e2eRun: E2eRun) {
  const suffix = e2eRun.masterIdSuffix;
  const primaryGameTitleId = `gt_ui_a_${suffix}`;
  const secondaryGameTitleId = `gt_ui_b_${suffix}`;
  const seasonMasterId = `season_ui_${suffix}`;
  const mapMasterId = `map_ui_${suffix}`;
  const primaryGameTitleName = `UI確認作品A ${suffix}`;
  const seasonName = `UI確認シーズン ${suffix}`;
  const mapName = `UI確認マップ ${suffix}`;
  // Keep the fixture historical so a parallel smoke run can own the latest-event shortcuts.
  const localDateTime = e2eRun.uniqueLocalDateTime(2000);
  const playedAt = new Date(`${localDateTime}:00+09:00`).toISOString();

  await postJson(request, e2eRun, "/api/game-titles", {
    id: primaryGameTitleId,
    layoutFamily: "momotetsu_2",
    name: primaryGameTitleName,
  } satisfies components["schemas"]["CreateGameTitleRequest"]);
  e2eRun.trackGameTitle(primaryGameTitleId);
  await postJson(request, e2eRun, "/api/game-titles", {
    id: secondaryGameTitleId,
    layoutFamily: "momotetsu_2",
    name: `UI確認作品B ${suffix}`,
  } satisfies components["schemas"]["CreateGameTitleRequest"]);
  e2eRun.trackGameTitle(secondaryGameTitleId);
  await postJson(request, e2eRun, "/api/season-masters", {
    gameTitleId: primaryGameTitleId,
    id: seasonMasterId,
    name: seasonName,
  } satisfies components["schemas"]["CreateSeasonMasterRequest"]);
  e2eRun.trackSeasonMaster(seasonMasterId);
  await postJson(request, e2eRun, "/api/map-masters", {
    gameTitleId: primaryGameTitleId,
    id: mapMasterId,
    name: mapName,
  } satisfies components["schemas"]["CreateMapMasterRequest"]);
  e2eRun.trackMapMaster(mapMasterId);

  const heldEvent = await postJson(request, e2eRun, "/api/held-events", {
    heldAt: playedAt,
  } satisfies components["schemas"]["CreateHeldEventRequest"]);
  const heldEventId = expectGeneratedId(heldEvent["id"], "held event ID");
  e2eRun.trackHeldEvent(heldEventId);
  const matchIds: string[] = [];
  for (const matchNoInEvent of [1, 2]) {
    const match = await postJson(request, e2eRun, "/api/matches", {
      draftIds: {},
      gameTitleId: primaryGameTitleId,
      heldEventId,
      mapMasterId,
      matchNoInEvent,
      ownerMemberId: "member_ponta",
      playedAt,
      players: makeUiPlayers(matchNoInEvent),
      seasonMasterId,
    } satisfies components["schemas"]["ConfirmMatchRequest"]);
    const matchId = expectGeneratedId(match["matchId"], "match ID");
    matchIds.push(matchId);
    e2eRun.trackMatch(matchId);
  }

  return {
    heldEventId,
    mapName,
    matchIds,
    primaryGameTitleId,
    primaryGameTitleName,
    seasonMasterId,
    seasonName,
    secondaryGameTitleId,
  };
}

function makeUiPlayers(seed: number): Array<components["schemas"]["PlayerResultRequest"]> {
  const memberIds = ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"];
  return memberIds.map((memberId, index) => ({
    incidents: {
      cardShop: 0,
      cardStation: 0,
      destination: 0,
      minusStation: 0,
      plusStation: 0,
      suriNoGinji: 0,
    },
    memberId,
    playOrder: index + 1,
    rank: index + 1,
    revenueManYen: seed * 100 + (4 - index) * 10,
    totalAssetsManYen: seed * 1_000 + (4 - index) * 100,
  }));
}
