import type { components } from "@/shared/api/generated";

export type IncidentCountsResponse = components["schemas"]["IncidentCountsResponse"];
export type PlayerResultResponse = components["schemas"]["PlayerResultResponse"];
export type MatchDetailResponse = components["schemas"]["MatchDetailResponse"];

export function zeroIncidents(): IncidentCountsResponse {
  return {
    destination: 0,
    plusStation: 0,
    minusStation: 0,
    cardStation: 0,
    cardShop: 0,
    suriNoGinji: 0,
  };
}

export function makeIncidents(
  overrides: Partial<IncidentCountsResponse> = {},
): IncidentCountsResponse {
  return { ...zeroIncidents(), ...overrides };
}

const defaultMemberOrder = [
  "member_ponta",
  "member_akane_mami",
  "member_otaka",
  "member_eu",
] as const;

export function makePlayerResult(
  overrides: Partial<PlayerResultResponse> & { playOrder: number },
): PlayerResultResponse {
  const { incidents: incidentsOverride, ...rest } = overrides;
  return {
    memberId: defaultMemberOrder[overrides.playOrder - 1] ?? "member_ponta",
    rank: overrides.playOrder,
    totalAssetsManYen: 100 - (overrides.playOrder - 1) * 10,
    revenueManYen: 10 - (overrides.playOrder - 1),
    ...rest,
    incidents: { ...zeroIncidents(), ...incidentsOverride },
  };
}

export function makeFourPlayerResults(
  overrides: Array<Partial<PlayerResultResponse>> = [],
): PlayerResultResponse[] {
  return [1, 2, 3, 4].map((playOrder) =>
    makePlayerResult({ playOrder, ...overrides[playOrder - 1] }),
  );
}

export function makeMatchDetail(overrides: Partial<MatchDetailResponse> = {}): MatchDetailResponse {
  return {
    matchId: "match-1",
    heldEventId: "held-1",
    matchNoInEvent: 1,
    gameTitleId: "gt_momotetsu_2",
    layoutFamily: "default",
    seasonMasterId: "season_current",
    ownerMemberId: "member_ponta",
    mapMasterId: "map_east",
    playedAt: "2026-04-04T12:34:56.000Z",
    createdByAccountId: "account_ponta",
    createdByMemberId: "member_ponta",
    createdAt: "2026-04-04T13:00:00.000Z",
    ...overrides,
  };
}
