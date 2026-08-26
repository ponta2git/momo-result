import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";

export type MatchFeatureView =
  | { kind: "loading" }
  | { kind: "ready-empty"; scopeLabel: string }
  | { kind: "with-items"; badges: MatchFeatureBadge[]; scopeLabel: string }
  | { kind: "load-failed"; onRetry: () => void; retrying: boolean }
  | { kind: "unavailable"; message: string };

const featureScopeLabel = "同じ作品・シーズン・マップの試合と比較";

export function buildMatchFeatureView({
  badges,
  failed,
  included,
  loading,
  matchChanged,
  onRetry,
  retrying,
}: {
  badges: MatchFeatureBadge[];
  failed: boolean;
  included: boolean;
  loading: boolean;
  matchChanged: boolean;
  onRetry: () => void;
  retrying: boolean;
}): MatchFeatureView {
  if (included) {
    return badges.length > 0
      ? { badges, kind: "with-items", scopeLabel: featureScopeLabel }
      : { kind: "ready-empty", scopeLabel: featureScopeLabel };
  }
  if (failed) return { kind: "load-failed", onRetry, retrying };
  if (loading) return { kind: "loading" };
  return {
    kind: "unavailable",
    message: matchChanged
      ? "この試合の更新後は、同じ条件の試合と比べた特徴を次の分析完了後に表示します。"
      : "同じ作品・シーズン・マップの試合と比べた特徴は、現在表示できません。",
  };
}
