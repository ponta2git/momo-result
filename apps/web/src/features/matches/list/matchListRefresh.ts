import { buildMatchListSearchParams } from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

/** A refreshed list is cached at its first page; summary failure does not invalidate that page. */
export type MatchListRefreshResult =
  | { kind: "refreshed"; origin: MatchListSearch; summaryFailed: boolean }
  | { kind: "failed"; origin: MatchListSearch };

export type MatchListRefreshFailure = {
  originScope: string;
  targetScope: string;
};

/** Only an unchanged selection may adopt the refreshed first page. */
export function resolveMatchListRefresh(current: MatchListSearch, result: MatchListRefreshResult) {
  const originScope = buildMatchListSearchParams(result.origin).toString();
  const nextSearch =
    result.kind === "refreshed" &&
    result.origin.cursor &&
    buildMatchListSearchParams(current).toString() === originScope
      ? { ...current, cursor: "" }
      : undefined;
  const failure: MatchListRefreshFailure | null =
    result.kind === "failed" || result.summaryFailed
      ? {
          originScope,
          targetScope: nextSearch ? buildMatchListSearchParams(nextSearch).toString() : originScope,
        }
      : null;

  return { nextSearch, failure };
}
