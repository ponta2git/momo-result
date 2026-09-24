import type { HeldEventDetailResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { compact } from "@/shared/lib/compact";

const defaultHeldAt = "2026-01-01T00:00:00.000Z";

export function makeHeldEventResponse(
  overrides: Partial<HeldEventResponse> = {},
): HeldEventResponse {
  const matchCount = overrides.matchCount ?? 0;
  return {
    draftCount: 0,
    heldAt: defaultHeldAt,
    id: "held-1",
    matchCount,
    nextMatchNo: matchCount + 1,
    ...overrides,
  };
}

export function makeHeldEventDetailResponse(
  overrides: Partial<HeldEventDetailResponse> = {},
): HeldEventDetailResponse {
  return {
    draftCount: 0,
    heldAt: defaultHeldAt,
    id: "held-1",
    matchCount: 0,
    nextMatchNo: 1,
    navigation: {},
    ...overrides,
    matches: (overrides.matches ?? []).map((match) => ({
      ...compact({
        gameTitleName: match.gameTitleId === "gt_momotetsu_2" ? "桃太郎電鉄2" : undefined,
        seasonName: match.seasonMasterId === "season_current" ? "今シーズン" : undefined,
        mapName: match.mapMasterId === "map_east" ? "東日本編" : undefined,
      }),
      ...match,
    })),
    drafts: (overrides.drafts ?? []).map((draft) => ({
      ...compact({
        gameTitleName: draft.gameTitleId === "gt_momotetsu_2" ? "桃太郎電鉄2" : undefined,
        seasonName: draft.seasonMasterId === "season_current" ? "今シーズン" : undefined,
        mapName: draft.mapMasterId === "map_east" ? "東日本編" : undefined,
      }),
      ...draft,
    })),
  };
}
