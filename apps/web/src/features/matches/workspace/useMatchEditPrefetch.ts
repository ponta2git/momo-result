import { usePrefetchQuery } from "@tanstack/react-query";

import { matchDetailPrefetchQueryOptions } from "@/shared/api/queryOptions";

/** Starts the primary edit payload before directory Suspense can pause the workspace render. */
export function useMatchEditPrefetch(matchId: string) {
  usePrefetchQuery(matchDetailPrefetchQueryOptions(matchId));
}
