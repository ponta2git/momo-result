import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { heldEventsQueryOptions } from "@/shared/api/queryOptions";
import {
  heldEventPickerPageSize,
  useHeldEventPickerDirectory,
} from "@/shared/api/useHeldEventPickerDirectory";
import { createTestQueryClient } from "@/test/queryClient";

function heldEvent(id: string, heldAt: string): HeldEventResponse {
  return { draftCount: 0, heldAt, id, matchCount: 4, nextMatchNo: 5 };
}

function pageResponse(
  items: HeldEventResponse[],
  page: number,
  totalItems: number,
): HeldEventListResponse {
  return {
    items,
    pagination: {
      hasNextPage: page * heldEventPickerPageSize < totalItems,
      hasPreviousPage: page > 1,
      page,
      pageSize: heldEventPickerPageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / heldEventPickerPageSize),
    },
    totalMatchCount: totalItems * 4,
  };
}

describe("useHeldEventPickerDirectory", () => {
  it("keeps the selected event resolved while moving through server-paged candidates", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(heldEventKeys.all(), { staleTime: Number.POSITIVE_INFINITY });
    const firstSelection = heldEvent("held-1", "2026-08-21T23:30:00.000Z");
    const secondPageEvent = heldEvent("held-21", "2026-03-01T23:30:00.000Z");
    queryClient.setQueryData(
      heldEventsQueryOptions({ page: 1, pageSize: heldEventPickerPageSize }).queryKey,
      pageResponse([firstSelection], 1, 63),
    );
    queryClient.setQueryData(
      heldEventsQueryOptions({ page: 2, pageSize: heldEventPickerPageSize }).queryKey,
      pageResponse([secondPageEvent], 2, 63),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useHeldEventPickerDirectory({ selectedId: firstSelection.id }),
      { wrapper },
    );

    expect(result.current.pagination?.page).toBe(1);
    expect(result.current.selectedHeldEvent).toEqual(firstSelection);

    act(() => result.current.onPageChange(2));

    await waitFor(() => expect(result.current.pagination?.page).toBe(2));
    expect(result.current.heldEvents).toEqual([secondPageEvent]);
    expect(result.current.selectedHeldEvent).toEqual(firstSelection);
  });
});
