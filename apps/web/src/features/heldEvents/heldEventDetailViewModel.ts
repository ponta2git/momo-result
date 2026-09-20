import type { HeldEventDraftResponse, HeldEventMatchResponse } from "@/shared/api/heldEvents";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeCompact, formatDateTimeLong } from "@/shared/lib/dateTime";

export type HeldEventPlayerRecap = {
  averageRank: number;
  displayName: string;
  matchCount: number;
  memberId: string;
  ranks: number[];
  wins: number;
};

export type HeldEventDraftAction = {
  href?: string;
  label: string;
};

export function buildHeldEventPlayerRecaps(
  matches: readonly HeldEventMatchResponse[],
): HeldEventPlayerRecap[] {
  const ranksByMember = new Map<string, number[]>();

  for (const match of matches.toSorted(
    (left, right) => left.matchNoInEvent - right.matchNoInEvent,
  )) {
    for (const player of match.players ?? []) {
      const ranks = ranksByMember.get(player.memberId) ?? [];
      ranks.push(player.rank);
      ranksByMember.set(player.memberId, ranks);
    }
  }

  return orderFixedMembers(
    [...ranksByMember.entries()].map(([memberId, ranks]) => ({
      averageRank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length,
      displayName: memberDisplayName(memberId),
      matchCount: ranks.length,
      memberId,
      ranks,
      wins: ranks.filter((rank) => rank === 1).length,
    })),
  );
}

export function heldEventDraftAction(draft: HeldEventDraftResponse): HeldEventDraftAction {
  if (draft.status === "ocr_running") {
    return { label: "読み取り中" };
  }
  if (draft.status === "ocr_failed") {
    return {
      href: `/matches/new?matchDraftId=${encodeURIComponent(draft.matchDraftId)}`,
      label: "手入力で続ける",
    };
  }
  return {
    href: `/review/${encodeURIComponent(draft.matchDraftId)}`,
    label: draft.status === "needs_review" ? "確認事項を直す" : "内容を確認",
  };
}

export function heldEventScopeLabel(
  match: Pick<HeldEventMatchResponse, "gameTitleName" | "mapName" | "seasonName">,
): string {
  return [
    match.gameTitleName ?? "作品名未取得",
    match.seasonName ?? "シーズン名未取得",
    match.mapName ?? "マップ名未取得",
  ].join("・");
}

export function heldEventDraftScopeLabel(
  draft: Pick<
    HeldEventDraftResponse,
    "gameTitleId" | "mapMasterId" | "seasonMasterId" | "gameTitleName" | "mapName" | "seasonName"
  >,
): string | undefined {
  const labels = [
    draft.gameTitleId ? (draft.gameTitleName ?? "作品名未取得") : undefined,
    draft.seasonMasterId ? (draft.seasonName ?? "シーズン名未取得") : undefined,
    draft.mapMasterId ? (draft.mapName ?? "マップ名未取得") : undefined,
  ].filter(Boolean);
  return labels.length > 0 ? labels.join("・") : undefined;
}

export function formatAverageRank(averageRank: number): string {
  return averageRank.toLocaleString("ja-JP", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 1,
  });
}

export function formatHeldEventDateTime(value: string): string {
  return formatDateTimeLong(value);
}

export function formatHeldEventShortDateTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return formatDateTimeCompact(value);
}
