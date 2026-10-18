import type { QueryClient } from "@tanstack/react-query";

import { matchDetailCacheFilter } from "@/shared/api/detailCache";
import type { MatchDetailReadResult } from "@/shared/api/detailReadResult";

/** Store only facts acknowledged by the write; attribution is hydrated by the next read. */
export async function commitMatchNoteCache(
  queryClient: QueryClient,
  saved: { matchId: string; expectedVersion: string; version: string; body?: string | undefined },
): Promise<void> {
  const filter = matchDetailCacheFilter(saved.matchId);
  await queryClient.cancelQueries(filter);
  queryClient.setQueriesData<MatchDetailReadResult>(
    {
      ...filter,
      predicate: (query) => query.queryKey.length === 4 && filter.predicate(query),
    },
    (current) => {
      if (current?.kind !== "found" || current.detail.note.version !== saved.expectedVersion)
        return current;
      return {
        ...current,
        detail: {
          ...current.detail,
          note: {
            version: saved.version,
            ...(saved.body === undefined ? {} : { body: saved.body }),
          },
        },
      };
    },
  );
}
