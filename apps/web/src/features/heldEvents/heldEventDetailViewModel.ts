import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import type { DetailNavigation, HeldEventNeighbor } from "@/shared/api/detailReadResult";
import type {
  HeldEventDetailResponse,
  HeldEventDraftResponse,
  HeldEventMatchResponse,
  HeldEventPlayerResultResponse,
} from "@/shared/api/heldEvents";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeCompact, formatNavigationDateTime } from "@/shared/lib/dateTime";
import type { AdjacentDestination } from "@/shared/ui/navigation/AdjacentNavigation";

type RefreshModel = {
  readonly disabled?: boolean;
  readonly pending: boolean;
  readonly run: () => void;
};

export type HeldEventMatchView = Readonly<Omit<HeldEventMatchResponse, "players">> & {
  readonly players?: ReadonlyArray<Readonly<HeldEventPlayerResultResponse>>;
};

export type HeldEventDetailReadyPageModel = {
  readonly event: {
    readonly detail: Readonly<
      Pick<HeldEventDetailResponse, "matchCount" | "draftCount" | "nextMatchNo">
    >;
    readonly drafts: ReadonlyArray<Readonly<HeldEventDraftResponse>>;
    readonly emphasizeNewMatch: boolean;
    readonly matches: readonly HeldEventMatchView[];
    readonly playerRecaps: readonly HeldEventPlayerRecap[];
  };
  readonly freshness:
    | { readonly kind: "current" }
    | { readonly kind: "stale"; readonly refresh: RefreshModel };
  readonly kind: "ready";
  readonly navigation: {
    readonly adjacent: {
      readonly previous: Readonly<AdjacentDestination>;
      readonly next: Readonly<AdjacentDestination>;
      readonly disabled: boolean;
      readonly status: "ready" | "refreshing" | "failed" | "unavailable";
    };
    readonly currentDateTime: string;
    readonly exportHref: string;
    readonly manualEntryHref: string;
    readonly ocrCaptureHref: string;
  };
  readonly refresh: RefreshModel;
};

export type HeldEventDetailPageModel =
  | { readonly kind: "loading" }
  | { readonly kind: "notFound" }
  | { readonly kind: "loadFailed"; readonly refresh: RefreshModel }
  | HeldEventDetailReadyPageModel;

/** Resolves display availability and projects one detail snapshot without owning its lifetime. */
export function buildHeldEventDetailPageModel({
  heldEventId,
  detail,
  navigation,
  notFound,
  error,
  pending,
  initialPending,
  stale,
  refresh,
}: {
  heldEventId: string;
  detail: HeldEventDetailResponse | undefined;
  navigation: DetailNavigation<HeldEventNeighbor> | undefined;
  notFound: boolean;
  error: unknown;
  pending: boolean;
  initialPending: boolean;
  stale: boolean;
  refresh: RefreshModel;
}): HeldEventDetailPageModel {
  if (notFound) return { kind: "notFound" };
  if (!detail && initialPending && !error && heldEventId.trim().length > 0) {
    return { kind: "loading" };
  }
  if (!detail || heldEventId.trim().length === 0) return { kind: "loadFailed", refresh };

  const matches = (detail.matches ?? []).toSorted(compareHeldEventMatches);
  const drafts = (detail.drafts ?? []).toSorted(
    (left, right) =>
      (left.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) -
        (right.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  const available = navigation?.kind === "available";
  const previous = available ? navigation.previous : undefined;
  const next = available ? navigation.next : undefined;
  const peers = [
    detail.heldAt,
    ...(previous ? [previous.heldAt] : []),
    ...(next ? [next.heldAt] : []),
  ];
  const encodedHeldEventId = encodeURIComponent(detail.id);
  return {
    event: {
      detail,
      drafts,
      emphasizeNewMatch: drafts.length === 0 && matches.length === 0,
      matches,
      playerRecaps: buildHeldEventPlayerRecaps(matches),
    },
    freshness: stale ? { kind: "stale", refresh } : { kind: "current" },
    kind: "ready",
    navigation: {
      adjacent: {
        previous: adjacentDestination(previous, "previous", detail, peers, available),
        next: adjacentDestination(next, "next", detail, peers, available),
        disabled: pending || Boolean(error) || !available,
        status: pending ? "refreshing" : error ? "failed" : available ? "ready" : "unavailable",
      },
      currentDateTime: formatNavigationDateTime(detail.heldAt, peers),
      exportHref: `/exports?heldEventId=${encodedHeldEventId}&format=csv`,
      manualEntryHref: `/matches/new?heldEventId=${encodedHeldEventId}`,
      ocrCaptureHref: heldEventOcrCaptureHref(detail.id),
    },
    refresh,
  };
}

function adjacentDestination(
  neighbor: HeldEventNeighbor | undefined,
  direction: "previous" | "next",
  current: HeldEventDetailResponse,
  peers: string[],
  available: boolean,
): AdjacentDestination {
  const label = direction === "previous" ? "前の開催" : "次の開催";
  if (!neighbor) {
    return {
      label,
      description: available
        ? direction === "previous"
          ? "最初の開催です"
          : "最後の開催です"
        : "行き先を確認できません",
    };
  }
  return {
    label,
    description: `${formatNavigationDateTime(neighbor.heldAt, peers)}${neighbor.heldAt === current.heldAt ? `（同日時の${label}）` : ""}`,
    href: `/held-events/${encodeURIComponent(neighbor.id)}`,
  };
}

function compareHeldEventMatches(left: HeldEventMatchView, right: HeldEventMatchView) {
  return left.matchNoInEvent - right.matchNoInEvent;
}

export type HeldEventPlayerRecap = {
  readonly averageRank: number;
  readonly displayName: string;
  readonly matchCount: number;
  readonly memberId: string;
  readonly ranks: readonly number[];
  readonly wins: number;
};

export type HeldEventDraftAction = {
  readonly href?: string;
  readonly label: string;
};

export function buildHeldEventPlayerRecaps(
  matches: readonly HeldEventMatchView[],
): readonly HeldEventPlayerRecap[] {
  const ranksByMember = new Map<string, number[]>();

  for (const match of matches.toSorted(compareHeldEventMatches)) {
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

export function formatHeldEventShortDateTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return formatDateTimeCompact(value);
}
