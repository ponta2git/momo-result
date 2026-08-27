import type { QueryClient } from "@tanstack/react-query";

import { heldEventKeys, matchKeys, ocrDraftKeys, seriesAnalysisKeys } from "@/shared/api/queryKeys";

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
  ]);
}

export async function invalidateAfterMatchConfirmed(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    invalidateAnalysisState(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterMatchDeleted(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    invalidateAnalysisState(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export function evictDeletedMatchDetail(queryClient: QueryClient, matchId: string): void {
  queryClient.removeQueries({ exact: true, queryKey: matchKeys.detail(matchId) });
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
    queryClient.invalidateQueries({ exact: true, queryKey: matchKeys.detail(matchId) }),
    queryClient.invalidateQueries({ queryKey: matchKeys.collections() }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
    invalidateAnalysisState(queryClient),
  ]);
}
