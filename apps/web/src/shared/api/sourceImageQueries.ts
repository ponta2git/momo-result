import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { downloadMatchDraftSourceImage } from "@/shared/api/matchDrafts";
import { sourceImageBlobKeys } from "@/shared/api/queryKeys";

export function sourceImageBlobQueryOptions(
  queryKey: ReturnType<typeof sourceImageBlobKeys.image>,
  imageUrl: string,
) {
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const blob = await downloadMatchDraftSourceImage(imageUrl, signal);
      if (blob.size > 3 * 1024 * 1024) {
        throw new Error("Source image exceeds the supported size.");
      }
      return blob;
    },
    // The workspace owns the finite request sequence and explicit eviction.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    networkMode: "always",
  });
}

export function evictDraftSourceImageBlobs(queryClient: QueryClient, draftId: string): void {
  // Removal also cancels Query's consumed AbortSignal. The owning workspace
  // observes removal synchronously and stops its scheduler before invalidation.
  queryClient.removeQueries({ queryKey: sourceImageBlobKeys.draft(draftId) });
}
