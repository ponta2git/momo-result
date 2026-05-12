import type { DraftReviewHandoffValues } from "@/shared/workflows/masterReturnHandoff";

type ReviewPlayerInput = DraftReviewHandoffValues["players"][number];

const defaultMemberOrder = [
  "member_ponta",
  "member_akane_mami",
  "member_otaka",
  "member_eu",
] as const;

function zeroReviewIncidents(): ReviewPlayerInput["incidents"] {
  return {
    cardShop: 0,
    cardStation: 0,
    destination: 0,
    minusStation: 0,
    plusStation: 0,
    suriNoGinji: 0,
  };
}

export function makeReviewPlayerInput(
  overrides: Partial<ReviewPlayerInput> & { playOrder: number },
): ReviewPlayerInput {
  const { incidents: incidentsOverride, ...rest } = overrides;
  return {
    memberId: defaultMemberOrder[overrides.playOrder - 1] ?? "member_ponta",
    rank: overrides.playOrder,
    totalAssetsManYen: 100,
    revenueManYen: 10,
    ...rest,
    incidents: { ...zeroReviewIncidents(), ...incidentsOverride },
  };
}

export function makeFourReviewPlayerInputs(
  overrides: Array<Partial<ReviewPlayerInput>> = [],
): ReviewPlayerInput[] {
  return [1, 2, 3, 4].map((playOrder) =>
    makeReviewPlayerInput({ playOrder, ...overrides[playOrder - 1] }),
  );
}

export function makeDraftReviewHandoffValues(
  overrides: Partial<DraftReviewHandoffValues> = {},
): DraftReviewHandoffValues {
  return {
    draftIds: {},
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    mapMasterId: "map_east",
    matchNoInEvent: 1,
    ownerMemberId: "member_ponta",
    playedAt: "2026-02-02T02:02:00.000Z",
    seasonMasterId: "season_current",
    players: makeFourReviewPlayerInputs(),
    ...overrides,
  };
}
