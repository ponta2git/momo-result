// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  mergeHeldEventItems,
  syncHeldEventCreatedCache,
  syncHeldEventDeletedCache,
  upsertHeldEventList,
} from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

const olderEvent: HeldEventResponse = {
  draftCount: 0,
  id: "held-old",
  heldAt: "2026-01-01T00:00:00.000Z",
  matchCount: 1,
  nextMatchNo: 2,
};

const newerEvent: HeldEventResponse = {
  draftCount: 0,
  id: "held-new",
  heldAt: "2026-01-02T00:00:00.000Z",
  matchCount: 0,
  nextMatchNo: 1,
};

describe("held event cache contract", () => {
  it("prepends an individually loaded event only when the list does not contain it", () => {
    expect(mergeHeldEventItems([newerEvent], olderEvent)).toEqual([olderEvent, newerEvent]);
    expect(mergeHeldEventItems([newerEvent], { ...newerEvent, matchCount: 9 })).toEqual([
      newerEvent,
    ]);
  });

  it("upserts held events in newest-first order without duplicates", () => {
    const result = upsertHeldEventList(
      { items: [olderEvent, { ...newerEvent, matchCount: 2 }] },
      newerEvent,
    );

    expect(result.items).toEqual([newerEvent, olderEvent]);
  });

  it("updates the shared directory and invalidates page-list caches after create", async () => {
    const queryClient = createTestQueryClient();
    const pageListKey = heldEventKeys.list({ page: 1, pageSize: 25 });
    const pageList = { items: [olderEvent] };
    queryClient.setQueryData(heldEventKeys.directory(), { items: [olderEvent] });
    queryClient.setQueryData(pageListKey, pageList);

    await syncHeldEventCreatedCache(queryClient, newerEvent);

    expect(queryClient.getQueryData(heldEventKeys.directory())).toEqual({
      items: [newerEvent, olderEvent],
      pagination: {
        hasNextPage: false,
        hasPreviousPage: false,
        page: 1,
        pageSize: 2,
        totalItems: 2,
        totalPages: 1,
      },
      totalMatchCount: 1,
    });
    expect(queryClient.getQueryData(pageListKey)).toBe(pageList);
    expect(queryClient.getQueryState(heldEventKeys.directory())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pageListKey)?.isInvalidated).toBe(true);
  });

  it("updates the shared directory and invalidates page-list caches after delete", async () => {
    const queryClient = createTestQueryClient();
    const pageListKey = heldEventKeys.list({ page: 2, pageSize: 25 });
    const pageList = { items: [newerEvent] };
    queryClient.setQueryData(heldEventKeys.directory(), { items: [newerEvent, olderEvent] });
    queryClient.setQueryData(pageListKey, pageList);

    await syncHeldEventDeletedCache(queryClient, newerEvent.id);

    expect(queryClient.getQueryData(heldEventKeys.directory())).toEqual({
      items: [olderEvent],
      pagination: {
        hasNextPage: false,
        hasPreviousPage: false,
        page: 1,
        pageSize: 1,
        totalItems: 1,
        totalPages: 1,
      },
      totalMatchCount: 1,
    });
    expect(queryClient.getQueryData(pageListKey)).toBe(pageList);
    expect(queryClient.getQueryState(heldEventKeys.directory())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pageListKey)?.isInvalidated).toBe(true);
  });
});
