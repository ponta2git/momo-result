import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { groupDrafts } from "@/features/matches/drafts/draftsPresentation";
import type { DraftAction, DraftGroupView } from "@/features/matches/drafts/draftsTypes";
import { useConfirmedDraftNavigation } from "@/features/matches/drafts/useConfirmedDraftNavigation";
import { invalidateAfterDraftCancelled } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft } from "@/shared/api/matchDrafts";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { matchListQueryOptions } from "@/shared/api/queryOptions";
import { evictDraftSourceImageBlobs } from "@/shared/api/sourceImageQueries";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

/** The API's largest page; more unconfirmed drafts than this is not an expected workload. */
const draftsQuery: ListMatchesQuery = {
  kind: "match_draft",
  pageSize: 200,
  sort: "updated_desc",
  status: "incomplete",
};

export type DraftsListView = {
  groups: DraftGroupView[];
  loadFailed: boolean;
  loading: boolean;
  navigation: {
    checkingIds: ReadonlySet<string>;
    errors: Readonly<Record<string, string>>;
    run: (action: DraftAction) => void;
  };
  refresh: { pending: boolean; refreshFailed: boolean; run: () => void };
  /** Rejects with a reader-facing message so the confirmation dialog can show it in place. */
  remove: (matchDraftId: string) => Promise<void>;
  totalItems: number | undefined;
  truncated: boolean;
};

/** Composes the unconfirmed-draft read, continue navigation, and cancellation for the page. */
export function useDraftsList(): DraftsListView {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const queryOptions = matchListQueryOptions(draftsQuery);
  const query = useQuery(queryOptions);
  const navigation = useConfirmedDraftNavigation();
  const cancel = useMutation({
    mutationFn: (matchDraftId: string) =>
      runIdempotentMutation(
        idempotencyKeys,
        "drafts.cancelMatchDraft",
        { matchDraftId },
        (options) => cancelMatchDraft(matchDraftId, options),
      ),
    onSuccess: async (_, matchDraftId) => {
      evictDraftSourceImageBlobs(queryClient, matchDraftId);
      // Preserve the committed cancellation even if refreshing the remaining drafts fails.
      // Cancel an older read before writing so it cannot restore the removed row.
      await queryClient.cancelQueries({ queryKey: queryOptions.queryKey, exact: true });
      queryClient.setQueryData(queryOptions.queryKey, (current) => {
        if (!current?.items?.some((item) => item.matchDraftId === matchDraftId)) return current;
        return {
          ...current,
          items: current.items.filter((item) => item.matchDraftId !== matchDraftId),
          pagination: { ...current.pagination, totalItems: current.pagination.totalItems - 1 },
        };
      });
      await invalidateAfterDraftCancelled(queryClient);
    },
  });
  const groups = useMemo(() => groupDrafts(query.data?.items ?? []), [query.data]);
  const { mutateAsync } = cancel;

  return {
    groups,
    loadFailed: shouldShowBlockingQueryError(query),
    loading: isInitialQueryLoading(query),
    navigation: {
      checkingIds: navigation.checkingIds,
      errors: navigation.errors,
      run: (action) => void navigation.run(action),
    },
    refresh: {
      pending: query.isFetching && !isInitialQueryLoading(query),
      refreshFailed: query.isRefetchError,
      run: () => void query.refetch(),
    },
    remove: async (matchDraftId) => {
      try {
        await mutateAsync(matchDraftId);
      } catch (error) {
        throw new Error(
          formatApiError(error, "下書きを破棄できませんでした。もう一度お試しください。"),
          { cause: error },
        );
      }
    },
    totalItems: query.data?.pagination.totalItems,
    truncated: query.data?.pagination.hasNextPage ?? false,
  };
}
