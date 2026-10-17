import { buildMatchDetailLedgerRows } from "@/features/matches/detail/matchDetailPresentation";
import type {
  MatchDetailLedgerRow,
  MatchFeatureBadge,
} from "@/features/matches/detail/matchDetailPresentation";
import type { MatchNoteEditorSource } from "@/features/matches/note/matchNoteEditing";
import type { DetailNavigation, MatchNeighbor } from "@/shared/api/detailReadResult";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { matchPerformanceContextFromArtifact } from "@/shared/matches/matchPerformanceContext";
import { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";

export type MatchDetailRefreshModel = {
  pending: boolean;
  run: () => void;
};

export type MatchDeletionModel = {
  confirm: () => Promise<void>;
  errorMessage: string | null;
  open: boolean;
  pending: boolean;
  setOpen: (open: boolean) => void;
};

export type MatchDetailReadyPageModel = {
  analysis: {
    comparisonContextStatus: "loading" | "ready" | "unavailable";
    badges: MatchFeatureBadge[];
    performanceContext: ReturnType<typeof matchPerformanceContextFromArtifact>;
  };
  deletion: MatchDeletionModel;
  identity: {
    gameTitle: string;
    heldAt: string;
    map: string;
    season: string;
  };
  kind: "ready";
  ledgerRows: MatchDetailLedgerRow[];
  match: MatchDetailResponse;
  navigation: {
    comparisonHref: string;
    editHref: string;
    exportHref: string;
    heldEventHref: string;
    adjacent: DetailNavigation<MatchNeighbor>;
    adjacentState: "current" | "pending" | "failed" | "unavailable";
  };
  refresh: MatchDetailRefreshModel;
};

type MatchDetailScreenState =
  | { kind: "loading" }
  | {
      kind: "notFound";
      refresh: MatchDetailRefreshModel;
    }
  | {
      kind: "loadFailed";
      refresh: MatchDetailRefreshModel;
    }
  | MatchDetailReadyPageModel;

export type MatchDetailPageModel = MatchDetailScreenState & {
  matchId: string;
  noteSource: MatchNoteEditorSource;
};

/** Resolves screen availability and combines recorded/derived values with current edit policy. */
export function buildMatchDetailPageModel({
  matchId,
  detail: match,
  navigation,
  notFound,
  pending,
  initialPending,
  error,
  analysis,
  deletion,
  noteSource,
  refresh,
}: {
  matchId: string;
  detail: MatchDetailResponse | undefined;
  navigation: DetailNavigation<MatchNeighbor> | undefined;
  notFound: boolean;
  pending: boolean;
  initialPending: boolean;
  error: unknown;
  analysis: MatchDetailReadyPageModel["analysis"];
  deletion: MatchDeletionModel;
  noteSource: MatchNoteEditorSource;
  refresh: MatchDetailRefreshModel;
}): MatchDetailPageModel {
  const common = { matchId, noteSource };
  if (notFound) return { ...common, kind: "notFound", refresh };
  if (!match && initialPending && matchId.trim()) return { ...common, kind: "loading" };
  if (!match) return { ...common, kind: "loadFailed", refresh };

  const adjacent = navigation ?? { kind: "unavailable" as const };
  return {
    ...common,
    analysis,
    deletion,
    identity: {
      gameTitle: match.gameTitleName ?? "未取得",
      heldAt: match.heldAt ?? match.playedAt,
      map: match.mapName ?? "未取得",
      season: match.seasonName ?? "未取得",
    },
    kind: "ready",
    ledgerRows: buildMatchDetailLedgerRows(match, analysis.performanceContext),
    match,
    navigation: {
      comparisonHref: seriesComparisonHrefForMatch(match),
      editHref: `/matches/${encodeURIComponent(match.matchId)}/edit`,
      exportHref: `/exports?matchId=${encodeURIComponent(match.matchId)}`,
      heldEventHref: `/held-events/${encodeURIComponent(match.heldEventId)}`,
      adjacent,
      adjacentState: pending
        ? "pending"
        : error
          ? "failed"
          : adjacent.kind === "unavailable"
            ? "unavailable"
            : "current",
    },
    refresh,
  };
}
