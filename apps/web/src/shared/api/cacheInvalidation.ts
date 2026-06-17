import type { QueryClient } from "@tanstack/react-query";

import {
  heldEventKeys,
  matchKeys,
  ocrDraftKeys,
  seriesComparisonKeys,
} from "@/shared/api/queryKeys";

async function invalidateMatchCollections(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.all() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.draft.all() }),
    queryClient.invalidateQueries({ queryKey: ocrDraftKeys.all() }),
    queryClient.invalidateQueries({ queryKey: seriesComparisonKeys.all() }),
  ]);
}

export async function invalidateAfterMatchConfirmed(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterMatchDeleted(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateMatchCollections(queryClient),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
  ]);
}

export async function invalidateAfterDraftCancelled(queryClient: QueryClient): Promise<void> {
  await invalidateMatchCollections(queryClient);
}

export async function invalidateAfterOcrSubmissionStarted(queryClient: QueryClient): Promise<void> {
  await invalidateMatchCollections(queryClient);
}

export async function invalidateAfterMatchUpdated(
  queryClient: QueryClient,
  matchId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.detail(matchId) }),
    queryClient.invalidateQueries({ queryKey: matchKeys.all() }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
    queryClient.invalidateQueries({ queryKey: seriesComparisonKeys.all() }),
  ]);
}
