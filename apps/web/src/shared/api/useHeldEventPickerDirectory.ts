import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  heldEventDetailQueryOptions,
  heldEventsQueryOptions,
} from "@/shared/api/queryOptions";

export const heldEventPickerPageSize = 20;

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
  const [rememberedSelection, setRememberedSelection] = useState<HeldEventResponse | undefined>();
  const directoryQuery = useQuery({
    ...heldEventsQueryOptions({ page, pageSize: heldEventPickerPageSize }),
    enabled,
  });
  const heldEvents = directoryQuery.data?.items ?? [];
  const selectedOnPage = heldEvents.find((event) => event.id === selectedId);
  const suppliedSelection = selectedEvent?.id === selectedId ? selectedEvent : undefined;
  const rememberedCurrentSelection =
    rememberedSelection?.id === selectedId ? rememberedSelection : undefined;
  const resolvedWithoutDetail =
    selectedOnPage ?? suppliedSelection ?? rememberedCurrentSelection;
  const selectedDetailQuery = useQuery(
    heldEventDetailQueryOptions(
      selectedId,
      enabled && Boolean(selectedId) && !resolvedWithoutDetail,
    ),
  );
  const resolvedSelection = resolvedWithoutDetail ?? selectedDetailQuery.data;

  const directoryFailed = shouldShowQueryError(directoryQuery);
  const selectionFailed = Boolean(
    selectedId && !resolvedSelection && shouldShowQueryError(selectedDetailQuery),
  );
  const error = directoryFailed
    ? pickerErrorMessage(directoryQuery.error)
    : selectionFailed
      ? pickerErrorMessage(selectedDetailQuery.error)
      : undefined;

  return {
    error,
    heldEvents,
    pagination: directoryQuery.data?.pagination,
    pending:
      directoryQuery.isFetching ||
      Boolean(selectedId && !resolvedSelection && selectedDetailQuery.isFetching),
    refetch: async () => {
      await directoryQuery.refetch();
      if (selectionFailed) await selectedDetailQuery.refetch();
    },
    selectedHeldEvent: resolvedSelection,
    onPageChange: (nextPage: number) => {
      if (directoryQuery.isFetching || nextPage < 1) return;
      const totalPages = directoryQuery.data?.pagination.totalPages;
      if (totalPages !== undefined && totalPages > 0 && nextPage > totalPages) return;
      if (resolvedSelection?.id === selectedId) setRememberedSelection(resolvedSelection);
      setPage(nextPage);
    },
  };
}

export type HeldEventPickerDirectory = ReturnType<typeof useHeldEventPickerDirectory>;
