import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
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
    comparisonHref: string;
    editHref: string;
    exportHref: string;
  };
  note: { refetchMatch: () => Promise<{ data?: MatchDetailResponse | undefined }> };
};

export type MatchDetailPageModel =
  | { kind: "loading" }
  | { kind: "notFound"; navigation: { backHref: string } }
  | {
      kind: "loadFailed";
      navigation: { backHref: string };
      refresh: MatchDetailRefreshModel;
    }
  | MatchDetailReadyPageModel;
