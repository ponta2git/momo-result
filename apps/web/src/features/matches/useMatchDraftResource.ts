import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { matchDraftDetailQueryOptions } from "@/shared/api/queryOptions";
import { evictDraftSourceImageBlobs } from "@/shared/api/sourceImageQueries";

/** Shares fresh draft reads and reconciles confirmation without owning a route or review UI. */
export function useMatchDraftResource() {
  const queryClient = useQueryClient();
  const readLatest = useCallback(
    (draftId: string) =>
      queryClient.fetchQuery({ ...matchDraftDetailQueryOptions(draftId), staleTime: 0 }),
    [queryClient],
  );
  const confirmationRecorded = useCallback(() => {
    void invalidateAfterMatchConfirmed(queryClient);
  }, [queryClient]);
  const releaseReviewImages = useCallback(
    (draftId: string) => evictDraftSourceImageBlobs(queryClient, draftId),
    [queryClient],
  );
  return { readLatest, confirmationRecorded, releaseReviewImages };
}
