import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import type { MatchNoteCommit, MatchNoteReadResult } from "@/features/matches/useMatchNoteEditor";
import type { DetailNavigation, MatchNeighbor } from "@/shared/api/detailReadResult";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { matchPerformanceContextFromArtifact } from "@/shared/matches/matchPerformanceContext";

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
  match: MatchDetailResponse;
  navigation: {
    backHref: string;
    backLabel: string;
    returnTo: string | undefined;
    comparisonHref: string;
    editHref: string;
    exportHref: string;
    currentHeldEventHref: string | undefined;
    fallbackReason: string | undefined;
    adjacent: DetailNavigation<MatchNeighbor>;
    adjacentState: "current" | "pending" | "failed" | "unavailable";
  };
  refresh: MatchDetailRefreshModel;
};

type MatchDetailScreenState =
  | { kind: "loading" }
  | {
      kind: "notFound";
      navigation: { backHref: string; backLabel: string; fallbackReason: string | undefined };
      refresh: MatchDetailRefreshModel;
    }
  | {
      kind: "loadFailed";
      navigation: { backHref: string; backLabel: string; fallbackReason: string | undefined };
      refresh: MatchDetailRefreshModel;
    }
  | MatchDetailReadyPageModel;

export type MatchDetailPageModel = MatchDetailScreenState & {
  matchId: string;
  note: {
    readLatest: () => Promise<MatchNoteReadResult>;
    commitSavedNote: (saved: MatchNoteCommit) => Promise<MatchNoteReadResult>;
  };
};
