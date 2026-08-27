import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import type { MatchFeatureView } from "@/features/matches/matchFeatureViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";

export type MatchDetailRefreshModel = {
  pending: boolean;
  run: () => void;
};

export type MatchDetailEnrichmentModel =
  | { kind: "complete" }
  | { kind: "pending" }
  | {
      fields: string[];
      kind: "warning";
      refresh: MatchDetailRefreshModel;
    };

export type MatchDetailReadyPageModel = {
  analysis: {
    comparisonContextStatus: "loading" | "ready" | "unavailable";
    featureView: MatchFeatureView;
    performanceContext: ReturnType<typeof matchPerformanceContextFromArtifact>;
  };
  deletion: {
    confirm: () => Promise<void>;
    errorMessage: string | null;
    open: boolean;
    pending: boolean;
    setOpen: (open: boolean) => void;
  };
  enrichment: MatchDetailEnrichmentModel;
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
  results: {
    players: NonNullable<MatchDetailResponse["players"]>;
    setSortKey: (key: MatchDetailSortKey) => void;
    sort: MatchDetailSortState;
  };
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

export function resolvedEnrichmentName(args: {
  failed: boolean;
  loading: boolean;
  name: string | undefined;
}): string {
  if (args.name) return args.name;
  if (args.loading) return "取得中…";
  if (args.failed) return "未取得";
  return "未設定";
}
