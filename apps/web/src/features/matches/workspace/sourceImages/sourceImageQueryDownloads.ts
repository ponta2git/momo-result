import { isCancelledError } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { SourceImageDownloadError } from "@/features/matches/workspace/sourceImages/sourceImageDownloads";
import type { SourceImageDownloads } from "@/features/matches/workspace/sourceImages/sourceImageDownloads";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { sourceImageBlobKeys } from "@/shared/api/queryKeys";
import { sourceImageBlobQueryOptions } from "@/shared/api/sourceImageQueries";

/** Owns the review's cached image reads, cancellation, and external lifetime notifications. */
export function createSourceImageQueryDownloads(
  client: QueryClient,
  draftId: string,
  accountId: string | undefined,
  scope: string,
): SourceImageDownloads {
  const active = new Set<ReturnType<typeof sourceImageBlobQueryOptions>>();

  return {
    acquire(item) {
      const options = sourceImageBlobQueryOptions(
        sourceImageBlobKeys.image(
          draftId,
          accountId,
          scope,
          item.kind,
          item.imageUrl,
          JSON.stringify([item.createdAt, item.contentType]),
        ),
        item.imageUrl,
      );
      active.add(options);

      return {
        async load() {
          try {
            return await client.fetchQuery(options);
          } catch (error) {
            if (isCancelledError(error)) throw new SourceImageDownloadError("cancelled", error);
            const { status } = normalizeUnknownApiError(error);
            const reason =
              status === 409
                ? "replaced"
                : status === 401 || status === 403 || status === 429
                  ? "paused"
                  : "failed";
            throw new SourceImageDownloadError(reason, error);
          }
        },
        cancel: () => {
          void client.cancelQueries({ queryKey: options.queryKey, exact: true });
        },
        release: () => {
          // Our own release is not an external end of the entire review scope.
          active.delete(options);
          client.removeQueries({ queryKey: options.queryKey, exact: true });
        },
        hasFailed: () => client.getQueryState(options.queryKey)?.status === "error",
      };
    },
    subscribeToClear: (onCleared) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === "removed" &&
          [...active].some((options) => options.queryKey === event.query.queryKey)
        ) {
          onCleared();
        }
      }),
  };
}
