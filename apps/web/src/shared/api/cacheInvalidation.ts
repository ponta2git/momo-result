import type { QueryClient } from "@tanstack/react-query";

import { achievementKeys } from "@/shared/api/achievementQueryOptions";
import { matchDetailCacheFilter } from "@/shared/api/detailCache";
import {
  heldEventKeys,
  matchKeys,
  ocrDraftKeys,
  seriesAnalysisKeys,
  seriesPlayerRadarKeys,
} from "@/shared/api/queryKeys";

async function invalidateMatchCollections(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.collections() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.draft.all() }),
    queryClient.invalidateQueries({ queryKey: ocrDraftKeys.all() }),
  ]);
}

async function invalidateAnalysisState(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.options() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
    queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.all() }),
    queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.scopeStatusRoot() }),
    queryClient.invalidateQueries({ queryKey: achievementKeys.all() }),
  ]);
}

export async function invalidateAfterMatchConfirmed(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    invalidateAnalysisState(queryClient),
    queryClient.invalidateQueries({
      queryKey: matchKeys.detailRoot(),
      predicate: ({ queryKey }) => queryKey.at(-1) === "read-result",
    }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterMatchDeleted(
  queryClient: QueryClient,
  matchId?: string,
): Promise<void> {
  if (matchId) await queryClient.cancelQueries(matchDetailCacheFilter(matchId));
  await Promise.all([
    invalidateMatchCollections(queryClient),
    invalidateAnalysisState(queryClient),
    resetMatchContexts(queryClient, matchId),
    queryClient.invalidateQueries({
      queryKey: matchKeys.detailRoot(),
      predicate: (query) =>
        query.queryKey.at(-1) === "read-result" &&
        (matchId === undefined || !matchDetailCacheFilter(matchId).predicate(query)),
    }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export function evictDeletedMatchDetail(queryClient: QueryClient, matchId: string): void {
  queryClient.removeQueries(matchDetailCacheFilter(matchId));
}

export async function invalidateAfterDraftCancelled(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterOcrSubmissionStarted(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterMatchUpdated(
  queryClient: QueryClient,
  matchId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: matchKeys.detailRoot(),
      predicate: ({ queryKey }) => queryKey.at(-1) === "read-result",
    }),
    queryClient.invalidateQueries({ queryKey: matchKeys.collections() }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
    invalidateAnalysisState(queryClient),
    resetMatchContexts(queryClient, matchId),
  ]);
}

export async function invalidateAfterMatchNoteReplaced(
  queryClient: QueryClient,
  matchId: string,
): Promise<void> {
  await Promise.all([
    // The editor owns the fresh detail read and its separate post-save failure state.
    queryClient.invalidateQueries({
      ...matchDetailCacheFilter(matchId),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({ queryKey: matchKeys.collections() }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.detailRoot() }),
  ]);
}

/** Live match inclusion must be revalidated after a revision change, including cached exclusions. */
function resetMatchContexts(queryClient: QueryClient, matchId: string | undefined): Promise<void> {
  return queryClient.resetQueries({
    queryKey: seriesAnalysisKeys.matchContextRoot(),
    predicate: ({ queryKey }) => {
      const params = queryKey.at(-1);
      return (
        matchId === undefined ||
        (typeof params === "object" &&
          params !== null &&
          "matchId" in params &&
          params.matchId === matchId)
      );
    },
  });
}
