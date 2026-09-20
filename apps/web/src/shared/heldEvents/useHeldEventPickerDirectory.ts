import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventSummaryQueryOptions, heldEventsQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

export const heldEventPickerPageSize = 20;

type HeldEventPickerRefetchOptions = {
  throwOnError?: boolean;
};

function pickerErrorMessage(error: unknown): string {
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 401
    ? "ログイン後に開催候補を読み込めます。"
    : normalized.detail || normalized.title;
}

/**
 * Owns the server-paged directory used by held-event choice dialogs.
 * The selected event is resolved independently so changing pages never loses the current label.
 */
export function useHeldEventPickerDirectory({
  enabled = true,
  selectedEvent,
  selectedId,
}: {
  enabled?: boolean | undefined;
  selectedEvent?: HeldEventResponse | undefined;
  selectedId: string;
}) {
  const [page, setPage] = useState(1);
  const directoryQuery = useQuery({
    ...heldEventsQueryOptions({ page, pageSize: heldEventPickerPageSize }),
    enabled,
  });
  const heldEvents = directoryQuery.data?.items ?? [];
  const selectedOnPage = heldEvents.find((event) => event.id === selectedId);
  const suppliedSelection = selectedEvent?.id === selectedId ? selectedEvent : undefined;
  const resolvedWithoutSummary = selectedOnPage ?? suppliedSelection;
  const selectedSummaryQuery = useQuery(
    heldEventSummaryQueryOptions(
      selectedId,
      enabled && Boolean(selectedId) && !resolvedWithoutSummary,
    ),
  );
  const resolvedSelection = resolvedWithoutSummary ?? selectedSummaryQuery.data;
  const scopeChanging = Boolean(directoryQuery.isPlaceholderData && directoryQuery.isFetching);

  const directoryFailed = shouldShowQueryError(directoryQuery);
  const selectionFailed = Boolean(
    selectedId && !resolvedSelection && shouldShowQueryError(selectedSummaryQuery),
  );
  const error = useRetryNotice(
    directoryFailed
      ? pickerErrorMessage(directoryQuery.error)
      : selectionFailed
        ? pickerErrorMessage(selectedSummaryQuery.error)
        : undefined,
    directoryQuery.isFetching || selectedSummaryQuery.isFetching,
    `${page}:${selectedId}`,
  );

  return {
    error,
    heldEvents,
    pagination: directoryQuery.data?.pagination,
    pending:
      directoryQuery.isFetching ||
      Boolean(selectedId && !resolvedSelection && selectedSummaryQuery.isFetching),
    refetch: async (options?: HeldEventPickerRefetchOptions) => {
      await directoryQuery.refetch({ cancelRefetch: false, ...options });
      if (selectionFailed) await selectedSummaryQuery.refetch({ cancelRefetch: false, ...options });
    },
    selectedHeldEvent: resolvedSelection,
    onPageChange: (nextPage: number) => {
      if (directoryQuery.isFetching || nextPage < 1) return;
      const totalPages = directoryQuery.data?.pagination.totalPages;
      if (totalPages !== undefined && totalPages > 0 && nextPage > totalPages) return;
      setPage(nextPage);
    },
    scopeChanging,
  };
}

export type HeldEventPickerDirectory = ReturnType<typeof useHeldEventPickerDirectory>;
