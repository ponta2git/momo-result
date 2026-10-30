import type {
  HeldEventDetailResponse,
  HeldEventListItemResponse,
  HeldEventListPlayerResultResponse,
  HeldEventResponse,
} from "@/shared/api/heldEvents";
import { canonicalResultMemberIds } from "@/shared/domain/members";
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

/** A list row; `averageRanks` lists canonical members' averages, deriving plausible rank counts. */
export function makeHeldEventListItem(
  overrides: Partial<HeldEventListItemResponse> & { averageRanks?: readonly number[] } = {},
): HeldEventListItemResponse {
  const { averageRanks, ...rest } = overrides;
  const base = makeHeldEventResponse(rest);
  return {
    ...base,
    playerResults: averageRanks ? makeHeldEventListPlayerResults(averageRanks) : [],
    ...rest,
  };
}

export function makeHeldEventListPlayerResults(
  averageRanks: readonly number[],
): HeldEventListPlayerResultResponse[] {
  return canonicalResultMemberIds.slice(0, averageRanks.length).map((memberId, index) => {
    const averageRank = averageRanks[index] ?? 2.5;
    const rank = Math.min(4, Math.max(1, Math.round(averageRank)));
    return {
      averageRank,
      memberId,
      rankCounts: [1, 2, 3, 4].map((candidate) => (candidate === rank ? 1 : 0)),
    };
  });
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
