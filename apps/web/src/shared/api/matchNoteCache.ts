import type { QueryClient } from "@tanstack/react-query";

import type { MatchDetailReadResult } from "@/shared/api/detailReadResult";
import { matchKeys } from "@/shared/api/queryKeys";

/** Store only facts acknowledged by the write; attribution is hydrated by the next read. */
export async function commitMatchNoteCache(
  queryClient: QueryClient,
  saved: { matchId: string; expectedVersion: string; version: string; body?: string | undefined },
): Promise<void> {
  const queryKey = matchKeys.detail(saved.matchId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<MatchDetailReadResult>(queryKey, (current) => {
    if (current?.kind !== "found" || current.detail.note.version !== saved.expectedVersion)
      return current;
    return {
      ...current,
      detail: {
        ...current.detail,
        note: { version: saved.version, ...(saved.body === undefined ? {} : { body: saved.body }) },
      },
    };
  });
}
